const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { ensureServerEntry } = require('./server-list');
const { migrateMapConfig } = require('./map-config');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class LauncherService {
  constructor({ app, emit }) {
    this.app = app;
    this.emit = emit;
    this.config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8'));
    this.config.minecraft = this.config.minecraft || {};
    this.config.minecraft.serverAddress = this.config.minecraft.serverAddress || 'poke.vilanexo.com';
    this.config.minecraft.serverPort = Number(this.config.minecraft.serverPort || 25565);
    this.baseConfig = JSON.parse(JSON.stringify(this.config));
    this.profiles = this.baseConfig.profiles || {};
    this.profileId = 'cobblemon';
    this.profile = {};
    this.downloadConfig = { concurrency: 12, assetConcurrency: 16, timeoutMs: 45000, retries: 3, forgeInstallTimeoutMs: 900000, ...(this.config.downloads || {}) };
    const root = path.join(app.getPath('appData'), 'VilaNexo');
    // Usa o diretÃ³rio padrÃ£o para o Minecraft persistir servers.dat normalmente.
    const gameDir = path.join(app.getPath('appData'), '.minecraft');
    this.paths = {
      root,
      gameDir,
      runtimeDir: path.join(root, 'runtime'),
      cacheDir: path.join(root, 'cache'),
      authFile: path.join(root, 'auth.json'),
      discordAuthFile: path.join(root, 'discord-auth.json'),
      managedFile: path.join(root, 'managed-files.json'),
      preferencesFile: path.join(root, 'launcher-preferences.json')
    };
    this.preferences = this.loadPreferences();
    this.activateProfile(this.profileId);
    for (const p of Object.values(this.paths)) if (!path.extname(p)) fs.mkdirSync(p, { recursive: true });
    fs.mkdirSync(path.join(this.paths.gameDir, 'mods'), { recursive: true });
    fs.mkdirSync(path.join(this.paths.gameDir, 'logs'), { recursive: true });
    fs.mkdirSync(this.getModsDir(), { recursive: true });
    const savedAuth = this.loadAuth();
    if (savedAuth && !savedAuth.offline) { try { fs.unlinkSync(this.paths.authFile); } catch {} }
    const savedDiscord = this.loadDiscordAuth();
    this.state = { busy: false, phase: 'Pronto', progress: 0, account: savedAuth?.offline ? savedAuth.profile : null, discord: savedDiscord?.profile || null, mods: { count: 0, names: [] } };
    this.modWatcher = null;
    this.scanLocalMods({ silent: true });
    this.watchLocalMods();
  }

  log(message, level = 'INFO') {
    const entry = { time: new Date().toLocaleTimeString('pt-BR'), level, message };
    this.emit('launcher:log', entry);
    console.log(`[${entry.time}] [${level}] ${message}`);
  }
  progress(phase, progress) {
    this.state.phase = phase; this.state.progress = progress;
    this.emit('launcher:progress', { phase, progress });
  }
  setBusy(busy) { this.state.busy = busy; this.emit('launcher:state', this.state); }
  getPublicConfig() { return { ...this.config }; }
  getState() { return this.state; }
  getLauncherVersion() { return require('../package.json').version; }

  activateProfile(profileId = 'cobblemon') {
    const profile = this.profiles[profileId] || this.profiles.cobblemon || {};
    this.profileId = profileId;
    this.profile = profile;
    this.config = JSON.parse(JSON.stringify(this.baseConfig));
    this.config.minecraft = { ...(this.baseConfig.minecraft || {}), ...(profile.minecraft || {}) };
    this.config.minecraft.serverAddress = profile.serverAddress || this.config.minecraft.serverAddress || 'poke.vilanexo.com';
    this.config.minecraft.serverPort = Number(profile.serverPort || this.config.minecraft.serverPort || 25565);
    this.applyPreferences();
    this.config.distribution = { ...(this.baseConfig.distribution || {}), ...(profile.distribution || {}) };
    if (this.paths) {
      this.paths.gameDir = path.join(this.paths.root, 'profiles', profileId);
      this.paths.managedFile = path.join(this.paths.root, `managed-files-${profileId}.json`);
      fs.mkdirSync(this.paths.gameDir, { recursive: true });
    }
    if (this.state) {
      this.state.profileId = profileId;
      this.state.profileName = profile.name || profileId;
    }
  }
  loadPreferences() { try { return JSON.parse(fs.readFileSync(this.paths.preferencesFile, 'utf8')); } catch { return {}; } }
  savePreferences() { fs.mkdirSync(this.paths.root, { recursive: true }); fs.writeFileSync(this.paths.preferencesFile, JSON.stringify(this.preferences, null, 2)); }
  applyPreferences() {
    if (!this.preferences) return;
    const min = Number(this.preferences.memoryMinMb);
    const max = Number(this.preferences.memoryMaxMb);
    if (Number.isFinite(min)) this.config.minecraft.memoryMinMb = min;
    if (Number.isFinite(max)) this.config.minecraft.memoryMaxMb = max;
    if (['balanced', 'performance', 'quality'].includes(this.preferences.performance)) this.config.minecraft.performance = this.preferences.performance;
  }
  updateSettings(settings = {}) {
    const min = Math.round(Number(settings.memoryMinMb));
    const max = Math.round(Number(settings.memoryMaxMb));
    const performance = String(settings.performance || 'balanced');
    if (!Number.isFinite(min) || min < 1024 || min > 16384) throw new Error('A memória inicial deve ficar entre 1024 e 16384 MB.');
    if (!Number.isFinite(max) || max < 2048 || max > 32768) throw new Error('A memória máxima deve ficar entre 2048 e 32768 MB.');
    if (min > max) throw new Error('A memória inicial não pode ser maior que a memória máxima.');
    if (!['balanced', 'performance', 'quality'].includes(performance)) throw new Error('Modo de desempenho inválido.');
    this.preferences = { memoryMinMb: min, memoryMaxMb: max, performance };
    this.savePreferences();
    this.applyPreferences();
    this.log(`Configurações salvas: ${min}-${max} MB, modo ${performance}.`, 'SUCESSO');
    return this.getPublicConfig();
  }
  async checkForUpdate() {
    const url = this.config.launcher?.updateUrl || 'https://www.vilanexo.com/launcher/update.json';
    const remote = await this.fetchJson(url);
    const current = this.getLauncherVersion();
    const newer = String(remote.version || '').split('.').map(Number);
    const local = current.split('.').map(Number);
    const hasUpdate = newer.length === 3 && newer.some((part, i) => part > (local[i] || 0)) && !newer.every((part, i) => part === (local[i] || 0));
    return { current, ...remote, hasUpdate };
  }

  getModsDir() {
    // Os mods administrados ficam ao lado do executÃ¡vel do launcher.
    // Assim o dono do servidor pode abrir a pasta e trocar os .jar sem recompilar o app.
    const base = this.app.isPackaged ? path.dirname(this.app.getPath('exe')) : path.join(__dirname, '..');
    return path.resolve(base, this.profile.localModsDir || 'mods');
  }

  getGameModsDir() { return path.join(this.paths.gameDir, 'mods'); }


  sanitizeLocalMods() {
    const modsDir = this.getModsDir();
    fs.mkdirSync(modsDir, { recursive: true });
    const disabledDir = path.join(path.dirname(modsDir), 'mods-desativados');
    fs.mkdirSync(disabledDir, { recursive: true });

    const files = fs.readdirSync(modsDir).filter(name => name.toLowerCase().endsWith('.jar'));
    const moved = [];

    // VersÃµes Universal/bootstrap do CustomSkinLoader usadas por builds anteriores
    // podem entrar no ModuleLayer do Forge como um mÃ³dulo separado e exportar pacotes
    // net.minecraft.*, causando ResolutionException. Para 1.20.1 usamos somente ForgeV2.
    for (const name of files) {
      if (/customskinloader/i.test(name) && !(/forgev2|forgev3/i.test(name))) {
        const src = path.join(modsDir, name);
        if (!fs.existsSync(src)) continue;
        let dst = path.join(disabledDir, name);
        if (fs.existsSync(dst)) {
          const ext = path.extname(name);
          const base = path.basename(name, ext);
          dst = path.join(disabledDir, `${base}-${Date.now()}${ext}`);
        }
        fs.renameSync(src, dst);
        moved.push(name);
        this.log(`CustomSkinLoader antigo/incompatÃ­vel desativado: ${name}`, 'AVISO');
      }
    }

    // Fabric API nÃ£o pode ser carregada diretamente em um perfil Forge 1.20.1.
    // Ela injeta mÃ³dulos Fabric (ex.: fabric_lifecycle_events_v1) e causa
    // java.lang.module.ResolutionException antes da tela principal do jogo.
    for (const name of files) {
      if ((this.config.minecraft.loader || 'forge').toLowerCase() !== 'fabric' && (/^fabric-api(?:-|_)/i.test(name) || /fabric-api-.*1\.20\.1/i.test(name))) {
        const src = path.join(modsDir, name);
        let dst = path.join(disabledDir, name);
        if (fs.existsSync(dst)) {
          const ext = path.extname(name);
          const base = path.basename(name, ext);
          dst = path.join(disabledDir, `${base}-${Date.now()}${ext}`);
        }
        fs.renameSync(src, dst);
        moved.push(name);
        this.log(`Mod incompatÃ­vel com Forge desativado automaticamente: ${name}`, 'AVISO');
      }
    }

    // Remove cÃ³pias do Windows do tipo "arquivo (1).jar" quando o original
    // com o mesmo nome tambÃ©m estÃ¡ presente. Isso evita IDs duplicados de mods.
    const remaining = new Set(fs.readdirSync(modsDir).filter(n => n.toLowerCase().endsWith('.jar')));
    for (const name of [...remaining]) {
      const m = name.match(/^(.*) \((\d+)\)(\.jar)$/i);
      if (!m) continue;
      const original = `${m[1]}${m[3]}`;
      if (!remaining.has(original)) continue;
      const src = path.join(modsDir, name);
      let dst = path.join(disabledDir, name);
      if (fs.existsSync(dst)) dst = path.join(disabledDir, `${m[1]} (${m[2]})-${Date.now()}${m[3]}`);
      fs.renameSync(src, dst);
      moved.push(name);
      this.log(`CÃ³pia duplicada desativada automaticamente: ${name}`, 'AVISO');
    }

    if (moved.length) {
      this.log(`${moved.length} mod(s) problemÃ¡tico(s) movido(s) para: ${disabledDir}`, 'INFO');
    }
    return moved;
  }

  getOfficialMinecraftDir() {
    // No Windows o launcher oficial usa %APPDATA%\\.minecraft.
    // Em outros sistemas usamos os caminhos padrÃ£o mais comuns.
    if (process.platform === 'win32') return path.join(this.app.getPath('appData'), '.minecraft');
    if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
    return path.join(os.homedir(), '.minecraft');
  }

  linkOrCopyFile(src, dst) {
    if (fs.existsSync(dst)) return false;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      // Hardlink: praticamente instantÃ¢neo e nÃ£o duplica espaÃ§o em disco.
      fs.linkSync(src, dst);
    } catch {
      fs.copyFileSync(src, dst);
    }
    return true;
  }

  importTreeMissing(srcRoot, dstRoot, onFile = null) {
    if (!fs.existsSync(srcRoot)) return { scanned: 0, imported: 0 };
    let scanned = 0, imported = 0;
    const stack = [[srcRoot, dstRoot]];
    while (stack.length) {
      const [srcDir, dstDir] = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        const src = path.join(srcDir, ent.name);
        const dst = path.join(dstDir, ent.name);
        if (ent.isDirectory()) stack.push([src, dst]);
        else if (ent.isFile()) {
          scanned++;
          if (this.linkOrCopyFile(src, dst)) imported++;
          if (onFile && scanned % 500 === 0) onFile({ scanned, imported });
        }
      }
    }
    return { scanned, imported };
  }

  async importExistingMinecraft() {
    const source = this.getOfficialMinecraftDir();
    if (!fs.existsSync(source) || path.resolve(source) === path.resolve(this.paths.gameDir)) {
      this.log('Minecraft oficial nÃ£o encontrado. O launcher baixarÃ¡ somente os arquivos necessÃ¡rios.', 'INFO');
      return false;
    }

    const marker = path.join(this.paths.root, '.import-minecraft-1.6.0.done');
    if (fs.existsSync(marker)) return true;

    this.progress('Reaproveitando Minecraft instalado', 7);
    this.log(`Minecraft existente encontrado em: ${source}`, 'SUCESSO');
    this.log('Reaproveitando assets, libraries e versÃµes jÃ¡ instaladas. Seus mods pessoais NÃƒO serÃ£o alterados.', 'INFO');

    let totalImported = 0;
    const importPart = (name, src, dst) => {
      if (!fs.existsSync(src)) return;
      this.log(`Importando ${name} da .minecraft existente...`, 'INFO');
      const r = this.importTreeMissing(src, dst, ({scanned, imported}) => {
        this.progress(`Reaproveitando ${name}: ${scanned} arquivos`, Math.min(14, 7 + Math.floor(scanned / 1500)));
      });
      totalImported += r.imported;
      this.log(`${name}: ${r.imported} arquivo(s) reaproveitado(s).`, r.imported ? 'SUCESSO' : 'INFO');
    };

    importPart('assets', path.join(source, 'assets'), path.join(this.paths.gameDir, 'assets'));
    importPart('libraries', path.join(source, 'libraries'), path.join(this.paths.gameDir, 'libraries'));

    const mc = this.config.minecraft.version;
    const forgeId = this.forgeVersionId();
    importPart(`versÃ£o ${mc}`, path.join(source, 'versions', mc), path.join(this.paths.gameDir, 'versions', mc));
    importPart(`Forge ${this.config.minecraft.forgeVersion}`, path.join(source, 'versions', forgeId), path.join(this.paths.gameDir, 'versions', forgeId));

    const profilesSrc = path.join(source, 'launcher_profiles.json');
    const profilesDst = path.join(this.paths.gameDir, 'launcher_profiles.json');
    if (fs.existsSync(profilesSrc) && !fs.existsSync(profilesDst)) this.linkOrCopyFile(profilesSrc, profilesDst);

    fs.writeFileSync(marker, JSON.stringify({ source, importedAt: new Date().toISOString(), files: totalImported }, null, 2), 'utf8');
    this.log(`ImportaÃ§Ã£o rÃ¡pida concluÃ­da: ${totalImported} arquivo(s) reaproveitado(s).`, 'SUCESSO');
    return true;
  }

  async syncLocalModsToGame() {
    const source = this.getModsDir();
    const target = this.getGameModsDir();
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    this.sanitizeLocalMods();

    const wanted = new Set(fs.readdirSync(source)
      .filter(name => name.toLowerCase().endsWith('.jar')));

    // Remove do jogo os .jar que jÃ¡ nÃ£o existem na pasta administrada do launcher.
    for (const name of fs.readdirSync(target)) {
      if (name.toLowerCase().endsWith('.jar') && !wanted.has(name)) {
        fs.rmSync(path.join(target, name), { force: true });
        this.log(`Mod removido do jogo: ${name}`, 'INFO');
      }
    }

    // Copia/atualiza apenas arquivos diferentes.
    for (const name of wanted) {
      const src = path.join(source, name);
      const dst = path.join(target, name);
      let copy = !fs.existsSync(dst);
      if (!copy) {
        const [a, b] = await Promise.all([fsp.stat(src), fsp.stat(dst)]);
        copy = a.size !== b.size || a.mtimeMs > b.mtimeMs + 1;
      }
      if (copy) {
        await fsp.copyFile(src, dst);
        const st = await fsp.stat(src);
        await fsp.utimes(dst, st.atime, st.mtime);
        this.log(`Mod atualizado: ${name}`, 'SUCESSO');
      }
    }
    return this.scanLocalMods({ silent: true });
  }

  scanLocalMods({ silent = false } = {}) {
    const modsDir = this.getModsDir();
    fs.mkdirSync(modsDir, { recursive: true });
    const names = fs.readdirSync(modsDir)
      .filter(name => name.toLowerCase().endsWith('.jar'))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    this.state.mods = { count: names.length, names };
    this.emit('launcher:mods', this.state.mods);
    this.emit('launcher:state', this.state);
    if (!silent) this.log(`${names.length} mod(s) detectado(s) na pasta de mods.`, 'INFO');
    return this.state.mods;
  }

  watchLocalMods() {
    const modsDir = this.getModsDir();
    try {
      this.modWatcher?.close?.();
      let timer = null;
      this.modWatcher = fs.watch(modsDir, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const before = this.state.mods?.count ?? 0;
          const current = this.scanLocalMods({ silent: true });
          if (current.count !== before) this.log(`Pasta de mods atualizada: ${current.count} mod(s) reconhecido(s).`, 'SUCESSO');
          else this.log('AlteraÃ§Ã£o detectada na pasta de mods.', 'INFO');
        }, 250);
      });
    } catch (e) {
      this.log(`NÃ£o foi possÃ­vel monitorar a pasta de mods: ${e.message}`, 'AVISO');
    }
  }

  loadAuth() { try { return JSON.parse(fs.readFileSync(this.paths.authFile, 'utf8')); } catch { return null; } }
  saveAuth(auth) { fs.mkdirSync(this.paths.root, { recursive: true }); fs.writeFileSync(this.paths.authFile, JSON.stringify(auth, null, 2)); }
  loadDiscordAuth() { try { return JSON.parse(fs.readFileSync(this.paths.discordAuthFile, 'utf8')); } catch { return null; } }
  saveDiscordAuth(auth) { fs.mkdirSync(this.paths.root, { recursive: true }); fs.writeFileSync(this.paths.discordAuthFile, JSON.stringify(auth, null, 2)); }
  logout() { try { fs.unlinkSync(this.paths.authFile); } catch {} try { fs.unlinkSync(this.paths.discordAuthFile); } catch {} this.state.account = null; this.state.discord = null; this.emit('launcher:state', this.state); return true; }

  offlineUuid(name) {
    const bytes = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const h = bytes.toString('hex');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }

  loginOffline(username) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Use um nome de 3 a 16 caracteres: letras, nÃºmeros ou _.');
    const profile = { name, id: this.offlineUuid(name) };
    const auth = { profile, access_token: '0', offline: true, expires_at: Date.now() + 315360000000 };
    this.saveAuth(auth);
    this.state.account = profile;
    this.emit('launcher:state', this.state);
    this.log(`Conta local ativa: ${name}.`, 'SUCESSO');
    return profile;
  }

  async fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
    return res.json();
  }
  async refreshAuthIfNeeded() {
    const auth = this.loadAuth();
    if (!auth || !auth.offline) throw new Error('Escolha seu nick em Perfil antes de jogar.');
    return auth;
  }

  async startDiscordLogin() {
    const url = this.config.auth?.launcherStartUrl;
    if (!url) throw new Error('Login Discord nÃ£o configurado.');
    const data = await this.fetchJson(url, { headers: { 'User-Agent': 'VilaNexoLauncher/1.9.1' } });
    if (!data?.nonce || !data?.loginUrl) throw new Error('Resposta invÃ¡lida do login Discord.');
    return data;
  }

  async pollDiscordLogin(nonce) {
    if (!nonce) throw new Error('SessÃ£o Discord invÃ¡lida.');
    const base = this.config.auth?.launcherStatusUrl;
    if (!base) throw new Error('Status Discord nÃ£o configurado.');
    const sep = base.includes('?') ? '&' : '?';
    const data = await this.fetchJson(`${base}${sep}nonce=${encodeURIComponent(nonce)}`, { headers: { 'User-Agent': 'VilaNexoLauncher/1.9.1' } });
    if (!data?.ok) return data;
    const auth = { token: data.token, profile: { id: data.userId, username: data.username }, savedAt: Date.now() };
    this.saveDiscordAuth(auth);
    this.state.discord = auth.profile;
    this.emit('launcher:state', this.state);
    this.log(`Discord autorizado: ${auth.profile.username}.`, 'SUCESSO');
    return data;
  }

  async verifyDiscordAccess() {
    const auth = this.loadDiscordAuth();
    if (!auth?.token) throw new Error('FaÃ§a login com Discord e tenha a whitelist aprovada antes de jogar.');
    const url = this.config.auth?.verifyUrl;
    if (!url) throw new Error('VerificaÃ§Ã£o Discord nÃ£o configurada.');
    const data = await this.fetchJson(url, { headers: { 'User-Agent': 'VilaNexoLauncher/1.9.1', 'Authorization': `Bearer ${auth.token}` } });
    if (!data?.ok) {
      try { fs.unlinkSync(this.paths.discordAuthFile); } catch {}
      this.state.discord = null;
      this.emit('launcher:state', this.state);
      throw new Error('Sua whitelist do Discord nÃ£o estÃ¡ aprovada ou expirou. FaÃ§a login novamente.');
    }
    this.state.discord = { id: data.userId, username: data.username };
    this.emit('launcher:state', this.state);
    return data;
  }

  ensureDiscordLogin() {
    const auth = this.loadDiscordAuth();
    if (!auth?.token) throw new Error('Faça login com Discord antes de entrar no servidor.');
    return auth;
  }


  async ensureCustomSkinLoader() {
    const modsDir = this.getGameModsDir();
    fs.mkdirSync(modsDir, { recursive: true });
    const loader = (this.config.minecraft.loader || '').toLowerCase();
    const isNeoForge = loader === 'neoforge';
    const isFabric = loader === 'fabric';
    if (isFabric) {
      const existing = fs.readdirSync(modsDir).find(n => /customskinloader/i.test(n) && n.toLowerCase().endsWith('.jar'));
      if (existing) return path.join(modsDir, existing);
      const managed = fs.readdirSync(this.getModsDir()).find(n => /customskinloader/i.test(n) && n.toLowerCase().endsWith('.jar'));
      if (managed) {
        const dst = path.join(modsDir, managed);
        fs.copyFileSync(path.join(this.getModsDir(), managed), dst);
        return dst;
      }
      const api = `https://api.modrinth.com/v2/project/customskinloader/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%22${this.config.minecraft.version}%22%5D`;
      const versions = await this.fetchJson(api, { headers: { 'User-Agent': 'VilaNexoLauncher/2.1.9' } });
      const selected = versions.flatMap(v => v.files || []).find(f => /fabric/i.test(f.filename || '') && String(f.filename).toLowerCase().endsWith('.jar'));
      if (!selected?.url) throw new Error('CustomSkinLoader Fabric compatível não encontrado.');
      const name = String(selected.filename).replace(/[^A-Za-z0-9._+()-]/g, '_');
      const dest = path.join(this.getModsDir(), name);
      await this.download(selected.url, dest);
      fs.copyFileSync(dest, path.join(modsDir, name));
      return path.join(modsDir, name);
    }

    const wantedLine = isNeoForge ? /forgev3/i : /forgev2/i;
    // Remove o bootstrap Universal que não inicia corretamente no NeoForge.
    if (isNeoForge) {
      for (const dir of [modsDir, this.getModsDir()]) {
        for (const file of fs.readdirSync(dir).filter(n => /customskinloader/i.test(n) && /universal/i.test(n) && n.toLowerCase().endsWith('.jar'))) {
          fs.rmSync(path.join(dir, file), { force: true });
        }
      }
    }
    const existing = fs.readdirSync(modsDir).find(n => /customskinloader/i.test(n) && wantedLine.test(n) && n.toLowerCase().endsWith('.jar'));
    if (existing) return path.join(modsDir, existing);

    const managedModsDir = this.getModsDir();
    fs.mkdirSync(managedModsDir, { recursive: true });
    const bundled = fs.readdirSync(managedModsDir).find(n => /customskinloader/i.test(n) && wantedLine.test(n) && n.toLowerCase().endsWith('.jar'));
    if (bundled) {
      const src = path.join(managedModsDir, bundled);
      const dst = path.join(modsDir, bundled);
      fs.copyFileSync(src, dst);
      return dst;
    }

    const loaderQuery = isNeoForge ? 'neoforge' : 'forge';
    const gameVersion = this.config.minecraft.version || (isNeoForge ? '1.21.1' : '1.20.1');
    const lineName = isNeoForge ? 'ForgeV3/NeoForge' : 'ForgeV2';
    this.log(`Preparando suporte a skins locais (CustomSkinLoader ${lineName})...`);
    const api = `https://api.modrinth.com/v2/project/customskinloader/version?loaders=%5B%22${loaderQuery}%22%5D&game_versions=%5B%22${gameVersion}%22%5D`;
    const versions = await this.fetchJson(api, { headers: { 'User-Agent': 'VilaNexoLauncher/2.1.9' } });
    if (!Array.isArray(versions) || !versions.length) throw new Error(`Não foi encontrada uma versão do CustomSkinLoader para ${loaderQuery} ${gameVersion}.`);

    // NeoForge 1.21.x usa a linha ForgeV3 específica.
    let selected = null;
    for (const v of versions) {
      const f = (v.files || []).find(x => wantedLine.test(String(x.filename || '')) && String(x.filename || '').toLowerCase().endsWith('.jar'));
      if (f?.url) { selected = f; break; }
    }
    if (!selected?.url) {
      throw new Error(`CustomSkinLoader ${lineName} não encontrado. A skin local foi preservada, mas não será aplicada no jogo.`);
    }

    const safeName = String(selected.filename || `CustomSkinLoader_${isNeoForge ? 'ForgeV3' : 'ForgeV2'}-VilaNexo.jar`).replace(/[^A-Za-z0-9._+()-]/g, '_');
    const managedDest = path.join(managedModsDir, safeName);
    const dest = path.join(modsDir, safeName);
    await this.download(selected.url, managedDest);
    fs.copyFileSync(managedDest, dest);

    const cslCore = path.join(this.paths.gameDir, 'CustomSkinLoader', 'Core');
    if (fs.existsSync(cslCore)) fs.rmSync(cslCore, { recursive: true, force: true });

    this.log(`Suporte a skins locais instalado: ${safeName}`, 'SUCESSO');
    this.scanLocalMods({ silent: true });
    return dest;
  }
  ensureCustomSkinLoaderConfig() {
    const cslDir = path.join(this.paths.gameDir, 'CustomSkinLoader');
    fs.mkdirSync(path.join(cslDir, 'LocalSkin', 'skins'), { recursive: true });
    const configPath = path.join(cslDir, 'CustomSkinLoader.json');
    const config = {
      enable: true,
      loadlist: [
        // Legacy reads `skin`, not `root`. USERNAME selects our local PNG;
        // it does not perform a Mojang lookup (unlike UUID placeholders).
        { name: 'VilaNexo LocalSkin', type: 'Legacy', skin: 'LocalSkin/skins/{USERNAME}.png', checkPNG: true }
      ],
      enableDynamicSkull: true,
      enableTransparentSkin: true,
      enableLocalProfileCache: false,
      enableLogStdOut: true
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    const officialDir = path.join(this.getOfficialMinecraftDir(), 'CustomSkinLoader');
    const officialConfig = path.join(officialDir, 'CustomSkinLoader.json');
    if (path.resolve(officialConfig).toLowerCase() !== path.resolve(configPath).toLowerCase()) {
      fs.mkdirSync(path.join(officialDir, 'LocalSkin', 'skins'), { recursive: true });
      fs.writeFileSync(officialConfig, JSON.stringify(config, null, 2), 'utf8');
    }
    return configPath;
  }

  restoreSavedSkin(username) {
    const name = String(username || '').trim();
    if (!name) return false;
    const saved = path.join(this.paths.root, 'skins', `${name}.png`);
    if (!fs.existsSync(saved)) return false;
    const isFabric = (this.config.minecraft.loader || '').toLowerCase() === 'fabric';
    const target = path.join(this.paths.gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', `${name}.png`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(saved, target);
    const officialTarget = path.join(this.getOfficialMinecraftDir(), 'CustomSkinLoader', 'LocalSkin', 'skins', `${name}.png`);
    if (path.resolve(officialTarget).toLowerCase() !== path.resolve(target).toLowerCase()) {
      fs.mkdirSync(path.dirname(officialTarget), { recursive: true });
      fs.copyFileSync(saved, officialTarget);
    }
    return true;
  }

  getSavedSkin(username) {
    const name = String(username || '').trim();
    if (!name) return null;
    const file = path.join(this.paths.root, 'skins', `${name}.png`);
    if (!fs.existsSync(file)) return null;
    const metaPath = path.join(this.paths.gameDir, 'VilaNexo', 'skin.json');
    let variant = 'classic';
    try { variant = JSON.parse(fs.readFileSync(metaPath, 'utf8')).variant || variant; } catch {}
    return { name, variant, dataUrl: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` };
  }

  async applyLocalSkin(filePath, username, variant = 'classic') {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Informe um nick de 3 a 16 caracteres antes de aplicar a skin.');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Selecione uma skin PNG vÃ¡lida.');
    const bytes = await fsp.readFile(filePath);
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) throw new Error('O arquivo selecionado nÃ£o Ã© um PNG vÃ¡lido.');
    if (bytes.length > 2 * 1024 * 1024) throw new Error('A skin Ã© muito grande. Use um PNG de atÃ© 2 MB.');

    const isFabric = (this.config.minecraft.loader || '').toLowerCase() === 'fabric';
    const skinDir = path.join(this.paths.gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
    await this.ensureCustomSkinLoader();
    this.ensureCustomSkinLoaderConfig();
    fs.mkdirSync(skinDir, { recursive: true });
    const dest = path.join(skinDir, `${name}.png`);
    await fsp.copyFile(filePath, dest);
    const officialSkinDir = path.join(this.getOfficialMinecraftDir(), 'CustomSkinLoader', 'LocalSkin', 'skins');
    const officialDest = path.join(officialSkinDir, `${name}.png`);
    if (path.resolve(officialDest).toLowerCase() !== path.resolve(dest).toLowerCase()) {
      fs.mkdirSync(officialSkinDir, { recursive: true });
      await fsp.copyFile(filePath, officialDest);
    }
    const savedDir = path.join(this.paths.root, 'skins');
    fs.mkdirSync(savedDir, { recursive: true });
    await fsp.copyFile(filePath, path.join(savedDir, `${name}.png`));
     const ownerUuid = this.loadAuth()?.profile?.id || this.offlineUuid(name);
     try { await this.publishSkin(filePath, name, ownerUuid); }
    catch (e) { this.log(`Skin salva localmente; sincronizaÃ§Ã£o online falhou: ${e.message}`, 'AVISO'); }

    // MantÃ©m uma cÃ³pia simples das preferÃªncias do VilaNexo. O CustomSkinLoader
    // lÃª a imagem pelo nome do jogador ao iniciar/reentrar no jogo.
    const metaDir = path.join(this.paths.gameDir, 'VilaNexo');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'skin.json'), JSON.stringify({ username: name, variant, file: dest, updatedAt: Date.now() }, null, 2));

    const current = this.loadAuth();
    if (!current || current.offline) this.loginOffline(name);
    this.log(`Skin local salva para ${name}.`, 'SUCESSO');
    return { name, local: true, path: dest };
  }

  async publishSkin(filePath, name, uuid = '') {
    const url = this.config.skins?.uploadUrl;
    if (!url) return;
    const bytes = await fsp.readFile(filePath);
    const form = new FormData();
    form.append('name', name);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(uuid))) form.append('uuid', String(uuid).toLowerCase());
    form.append('skin', new Blob([bytes], { type: 'image/png' }), `${name}.png`);
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`NÃ£o foi possÃ­vel sincronizar a skin (HTTP ${res.status}).`);
    this.log(`Skin sincronizada no servidor para ${name}.`, 'SUCESSO');
  }

   async syncServerSkins() {
    const indexUrl = this.config.skins?.indexUrl;
    const baseUrl = this.config.skins?.baseUrl;
    if (!indexUrl || !baseUrl) return;
      const entries = await this.fetchJson(indexUrl, { headers: { 'User-Agent': 'VilaNexoLauncher/2.3.8' } });
     if (!Array.isArray(entries)) return;
    const dir = path.join(this.paths.gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins');
    fs.mkdirSync(dir, { recursive: true });
      for (const entry of entries) {
       const name = typeof entry === 'string' ? entry : String(entry?.name || '');
       const uuid = typeof entry === 'object' ? String(entry.uuid || '') : '';
       if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) continue;
       const target = path.join(dir, `${name}.png`);
       try { fs.rmSync(target, { force: true }); } catch {}
       const skinUrl = uuid ? `${baseUrl.replace(/name=$/, '')}uuid=${encodeURIComponent(uuid)}&name=${encodeURIComponent(name)}&v=${Date.now()}` : `${baseUrl}${encodeURIComponent(name)}&v=${Date.now()}`;
        await this.download(skinUrl, target, null, null, { label: `Skin ${name}` });
      }
      this.log(`Skins sincronizadas por UUID: ${entries.length}.`, 'SUCESSO');
  }

  async uploadSkin(filePath, variant = 'classic', offlineName = '') {
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Selecione uma skin PNG vÃ¡lida.');
    variant = String(variant || '').toLowerCase();
    if (!['classic', 'slim'].includes(variant)) throw new Error('Modelo de skin invÃ¡lido.');
    if (path.extname(filePath).toLowerCase() !== '.png') throw new Error('A skin precisa estar no formato PNG.');
    const auth = this.loadAuth();
    // The active account is authoritative. Never let a stale nick field
    // publish the skin under another player identity.
    const name = String(auth?.profile?.name || auth?.profile?.username || offlineName || '').trim();
    return this.applyLocalSkin(filePath, name, variant);
  }

  async download(url, destination, expectedSha1 = null, expectedSha256 = null, options = {}) {
    const { onProgress = null, label = path.basename(destination) } = options;
    if (fs.existsSync(destination)) {
      if (expectedSha1 && await this.hashFile(destination, 'sha1') === expectedSha1) return { cached: true, bytes: fs.statSync(destination).size };
      if (expectedSha256 && await this.hashFile(destination, 'sha256') === expectedSha256) return { cached: true, bytes: fs.statSync(destination).size };
      if (!expectedSha1 && !expectedSha256) return { cached: true, bytes: fs.statSync(destination).size };
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tmp = destination + '.part';
    const retries = Math.max(1, Number(this.downloadConfig.retries) || 3);
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutMs = Number(this.downloadConfig.timeoutMs) || 45000;
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
      try {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        const res = await fetch(url, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'VilaNexoLauncher/1.2.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const total = Number(res.headers.get('content-length') || 0);
        const file = fs.createWriteStream(tmp);
        let received = 0;
        let lastTick = Date.now();
        let lastBytes = 0;
        await new Promise((resolve, reject) => {
          const { Readable, Transform } = require('stream');
          const meter = new Transform({ transform(chunk, enc, cb) {
            received += chunk.length;
            const now = Date.now();
            if (onProgress && now - lastTick >= 500) {
              const elapsed = Math.max(1, now - lastTick) / 1000;
              const speed = (received - lastBytes) / elapsed;
              try { onProgress({ received, total, speed, label }); } catch {}
              lastTick = now; lastBytes = received;
            }
            cb(null, chunk);
          }});
          Readable.fromWeb(res.body).pipe(meter).pipe(file).on('finish', resolve).on('error', reject);
          meter.on('error', reject);
        });
        clearTimeout(timer);
        if (expectedSha1 && await this.hashFile(tmp, 'sha1') !== expectedSha1) throw new Error(`SHA1 invÃ¡lido: ${path.basename(destination)}`);
        if (expectedSha256 && await this.hashFile(tmp, 'sha256') !== expectedSha256) throw new Error(`SHA256 invÃ¡lido: ${path.basename(destination)}`);
        fs.renameSync(tmp, destination);
        if (onProgress) onProgress({ received, total: total || received, speed: 0, label, done: true });
        return { cached: false, bytes: received };
      } catch (e) {
        clearTimeout(timer);
        lastError = e;
        try { fs.rmSync(tmp, { force: true }); } catch {}
        if (attempt < retries) {
          const wait = Math.min(5000, 800 * (2 ** (attempt - 1)));
          this.log(`Download falhou (${label}), tentativa ${attempt}/${retries}. Tentando novamente em ${Math.round(wait/1000)}s...`, 'AVISO');
          await sleep(wait);
        }
      }
    }
    throw new Error(`Falha ao baixar ${label} apÃ³s ${retries} tentativas: ${lastError?.message || lastError}`);
  }

  async runPool(items, worker, concurrency = this.downloadConfig.concurrency) {
    const list = Array.from(items || []);
    if (!list.length) return;
    let next = 0;
    const count = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
    const runners = Array.from({ length: count }, async () => {
      while (true) {
        const index = next++;
        if (index >= list.length) return;
        await worker(list[index], index, list.length);
      }
    });
    await Promise.all(runners);
  }

  formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${(n/1024).toFixed(1)} KB`;
    return `${(n/1024/1024).toFixed(1)} MB`;
  }

  hashFile(file, algo) { return new Promise((resolve, reject) => { const h=crypto.createHash(algo); const s=fs.createReadStream(file); s.on('data',d=>h.update(d)); s.on('end',()=>resolve(h.digest('hex'))); s.on('error',reject); }); }

  platformInfo() {
    const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    return { platform, arch };
  }

  async ensureJava21() {
    const exe = process.platform === 'win32' ? 'java.exe' : 'java';
    const candidates = [];
    const walk = (dir, depth=0) => {
      if (!fs.existsSync(dir) || depth > 5) return;
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name); let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, depth+1);
        else if (name === exe && path.basename(path.dirname(p)) === 'bin') candidates.push(p);
      }
    };
    walk(this.paths.runtimeDir);
    // Tenta reutilizar o Java 21 instalado pelo launcher oficial do Minecraft.
    const officialRuntime = path.join(this.getOfficialMinecraftDir(), 'runtime');
    walk(officialRuntime);
    const { spawnSync } = require('child_process');
    for (const candidate of candidates) {
      try {
        const r = spawnSync(candidate, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
        const txt = `${r.stdout || ''} ${r.stderr || ''}`;
        if (/version\s+"21(?:\.|")/.test(txt) || /openjdk version "21/.test(txt)) {
          if (candidate.startsWith(officialRuntime)) this.log('Java 21 reaproveitado da instalaÃ§Ã£o oficial do Minecraft.', 'SUCESSO');
          return candidate;
        }
      } catch {}
    }

    this.progress('Baixando Java 21', 5); this.log('Java 21 nÃ£o encontrado. Baixando runtime...');
    const { arch } = this.platformInfo();
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
    const archive = path.join(this.paths.cacheDir, `java21.${ext}`);
    const url = `https://api.adoptium.net/v3/binary/latest/21/ga/${osName}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
    await this.download(url, archive);
    fs.rmSync(this.paths.runtimeDir, { recursive: true, force: true }); fs.mkdirSync(this.paths.runtimeDir, { recursive: true });
    await this.extractArchive(archive, this.paths.runtimeDir);
    candidates.length = 0; walk(this.paths.runtimeDir);
    if (!candidates[0]) throw new Error('Java 21 foi baixado, mas o executÃ¡vel java nÃ£o foi encontrado.');
    this.log('Java 21 instalado com sucesso.', 'SUCESSO');
    return candidates[0];
  }

  async installVanilla() {
    const mc = this.config.minecraft.version;
    this.progress('Preparando Minecraft', 15); this.log(`Verificando Minecraft ${mc}...`);
    const manifest = await this.fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const entry = manifest.versions.find(v => v.id === mc);
    if (!entry) throw new Error(`VersÃ£o Minecraft ${mc} nÃ£o encontrada.`);
    const vjsonPath = path.join(this.paths.gameDir, 'versions', mc, `${mc}.json`);
    await this.download(entry.url, vjsonPath, entry.sha1);
    const vjson = JSON.parse(fs.readFileSync(vjsonPath, 'utf8'));
    const jarPath = path.join(this.paths.gameDir, 'versions', mc, `${mc}.jar`);
    await this.download(vjson.downloads.client.url, jarPath, vjson.downloads.client.sha1);
    await this.installLibraries(vjson);
    await this.installAssets(vjson);
    return vjson;
  }

  ruleAllowed(rules = []) {
    if (!rules || rules.length === 0) return true;
    const { platform, arch } = this.platformInfo(); let allowed = false;
    for (const r of rules) {
      let matches = true;
      if (r.os?.name && r.os.name !== platform) matches = false;
      if (r.os?.arch && !arch.includes(r.os.arch.replace('x86','32'))) matches = false;
      // Recursos opcionais do launcher oficial (demo, resoluÃ§Ã£o customizada,
      // quick-play etc.) nÃ£o sÃ£o ativados pelo VilaNexo.
      if (r.features && Object.keys(r.features).length) matches = false;
      if (matches) allowed = r.action === 'allow';
    }
    return allowed;
  }

  async installLibraries(vjson) {
    const libsDir = path.join(this.paths.gameDir, 'libraries');
    const { platform } = this.platformInfo();
    const jobs = [];
    for (const lib of (vjson.libraries || [])) {
      if (!this.ruleAllowed(lib.rules)) continue;
      if (lib.downloads?.artifact) {
        const a = lib.downloads.artifact;
        if (a.url && a.path) jobs.push({ url: a.url, dest: path.join(libsDir, a.path), sha1: a.sha1 });
      }
      const nativeKey = lib.natives?.[platform];
      if (nativeKey && lib.downloads?.classifiers?.[nativeKey]) {
        const n = lib.downloads.classifiers[nativeKey];
        jobs.push({ url: n.url, dest: path.join(libsDir, n.path), sha1: n.sha1 });
      }
    }
    let done = 0;
    await this.runPool(jobs, async job => {
      await this.download(job.url, job.dest, job.sha1);
      done++;
      if (done % 5 === 0 || done === jobs.length) this.progress(`Bibliotecas (${done}/${jobs.length})`, 18 + Math.round(7*done/Math.max(1,jobs.length)));
    });
  }

  async installAssets(vjson) {
    const ai = vjson.assetIndex;
    const indexPath = path.join(this.paths.gameDir, 'assets', 'indexes', `${ai.id}.json`);
    await this.download(ai.url, indexPath, ai.sha1);
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const objects = Object.values(index.objects || {});
    let done = 0;
    await this.runPool(objects, async obj => {
      const h = obj.hash;
      const dest = path.join(this.paths.gameDir, 'assets', 'objects', h.slice(0,2), h);
      await this.download(`https://resources.download.minecraft.net/${h.slice(0,2)}/${h}`, dest, h);
      done++;
      if (done % 50 === 0 || done === objects.length) this.progress(`Assets (${done}/${objects.length})`, 25 + Math.round(10*done/Math.max(1,objects.length)));
    }, this.downloadConfig.assetConcurrency);
  }

  forgeVersionId() { return `${this.config.minecraft.version}-forge-${this.config.minecraft.forgeVersion}`; }
  neoforgeVersionId() { return `neoforge-${this.config.minecraft.neoforgeVersion}`; }
  async ensureForge(javaPath) {
    const mc = this.config.minecraft.version, forge = this.config.minecraft.forgeVersion;
    const id = this.forgeVersionId();
    const vjsonPath = path.join(this.paths.gameDir, 'versions', id, `${id}.json`);
    if (fs.existsSync(vjsonPath)) { this.log(`Forge ${forge} jÃ¡ instalado. Pulando reinstalaÃ§Ã£o.`, 'SUCESSO'); return id; }
    this.progress('Baixando instalador do Forge', 40); this.log(`Baixando Forge ${forge}...`);
    fs.mkdirSync(this.paths.cacheDir, { recursive: true });
    const installer = path.join(this.paths.cacheDir, `forge-${mc}-${forge}-installer.jar`);
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mc}-${forge}/forge-${mc}-${forge}-installer.jar`;
    await this.download(url, installer, null, null, { label: `Forge ${forge}`, onProgress: ({received,total,speed}) => {
      const pct = total ? Math.min(100, Math.round(received*100/total)) : 0;
      const speedText = speed ? ` â€¢ ${(speed/1024/1024).toFixed(1)} MB/s` : '';
      this.progress(`Forge: ${this.formatBytes(received)}${total ? ` / ${this.formatBytes(total)} (${pct}%)` : ''}${speedText}`, 40 + Math.round(5*(total ? received/total : 0)));
    }});
    fs.mkdirSync(this.paths.gameDir, { recursive: true });
    const profiles = path.join(this.paths.gameDir, 'launcher_profiles.json');
    if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({profiles:{},settings:{},version:3}, null, 2));
    this.progress('Instalando Forge (pode levar alguns minutos)', 46);
    this.log('Executando o instalador do Forge. Ele pode baixar bibliotecas adicionais; o launcher continuarÃ¡ mostrando atividade.', 'INFO');
    await this.exec(javaPath, ['-jar', installer, '--installClient', this.paths.gameDir], this.paths.gameDir, {
      timeoutMs: this.downloadConfig.forgeInstallTimeoutMs,
      heartbeatMs: 10000,
      heartbeat: elapsed => this.progress(`Instalando Forge... ${Math.floor(elapsed/1000)}s`, Math.min(58, 46 + Math.floor(elapsed/30000)))
    });
    if (!fs.existsSync(vjsonPath)) {
      this.log('Tentando instalaÃ§Ã£o Forge em modo compatibilidade...', 'AVISO');
      await this.exec(javaPath, ['-jar', installer, '--installClient'], this.paths.gameDir, { timeoutMs: this.downloadConfig.forgeInstallTimeoutMs, heartbeatMs: 10000 });
    }
    if (!fs.existsSync(vjsonPath)) throw new Error('O instalador do Forge terminou, mas o perfil Forge nÃ£o foi encontrado. Verifique a versÃ£o Forge configurada.');
    this.log('Forge instalado.', 'SUCESSO');
    return id;
  }

  async ensureNeoForge(javaPath) {
    const mc = this.config.minecraft.version, neo = this.config.minecraft.neoforgeVersion;
    const versionsDir = path.join(this.paths.gameDir, 'versions');
    const candidates = [this.neoforgeVersionId(), `${mc}-neoforge-${neo}`];
    const findInstalled = () => candidates.find(id => fs.existsSync(path.join(versionsDir, id, `${id}.json`)));
    const installed = findInstalled();
    if (installed) { this.log(`NeoForge ${neo} jÃ¡ instalado. Pulando reinstalaÃ§Ã£o.`, 'SUCESSO'); return installed; }
    this.progress('Baixando instalador do NeoForge', 40);
    fs.mkdirSync(this.paths.cacheDir, { recursive: true });
    const installer = path.join(this.paths.cacheDir, `neoforge-${neo}-installer.jar`);
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neo}/neoforge-${neo}-installer.jar`;
    await this.download(url, installer, null, null, { label: `NeoForge ${neo}` });
    fs.mkdirSync(this.paths.gameDir, { recursive: true });
    const profiles = path.join(this.paths.gameDir, 'launcher_profiles.json');
    if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({profiles:{},settings:{},version:3}, null, 2));
    await this.exec(javaPath, ['-jar', installer, '--installClient', this.paths.gameDir], this.paths.gameDir, {
      timeoutMs: this.downloadConfig.forgeInstallTimeoutMs,
      heartbeatMs: 10000,
      heartbeat: elapsed => this.progress(`Instalando NeoForge... ${Math.floor(elapsed/1000)}s`, Math.min(58, 46 + Math.floor(elapsed/30000)))
    });
    const resolved = findInstalled();
    if (!resolved) throw new Error('O instalador do NeoForge terminou, mas o perfil NeoForge nÃ£o foi encontrado.');
    this.log(`NeoForge ${neo} instalado.`, 'SUCESSO');
    return resolved;
  }

  async ensureFabric() {
    const mc = this.config.minecraft.version;
    const loader = this.config.minecraft.loaderVersion || '0.19.5';
    const id = `fabric-loader-${loader}-${mc}`;
    const versionDir = path.join(this.paths.gameDir, 'versions', id);
    const versionPath = path.join(versionDir, `${id}.json`);
    if (!fs.existsSync(versionPath)) {
      this.progress('Preparando Fabric', 40);
      const url = `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`;
      const profile = await this.fetchJson(url, { headers: { 'User-Agent': 'VilaNexoLauncher/2.0.0' } });
      fs.mkdirSync(versionDir, { recursive: true });
      fs.writeFileSync(versionPath, JSON.stringify(profile, null, 2), 'utf8');
      this.log(`Fabric ${loader} preparado para Minecraft ${mc}.`, 'SUCESSO');
    }
    return id;
  }


  async extractArchive(archive, destination) {
    fs.mkdirSync(destination, { recursive: true });
    if (process.platform === 'win32') {
      const ps = [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `& { $ErrorActionPreference='Stop'; if ('${archive.replace(/'/g,"''")}'.ToLower().EndsWith('.zip')) { Expand-Archive -LiteralPath '${archive.replace(/'/g,"''")}' -DestinationPath '${destination.replace(/'/g,"''")}' -Force } else { tar -xf '${archive.replace(/'/g,"''")}' -C '${destination.replace(/'/g,"''")}' } }`
      ];
      await this.exec('powershell.exe', ps, destination);
      return;
    }
    await this.exec('tar', ['-xf', archive, '-C', destination], destination);
  }

  async extractNativeArchive(archive, destination) {
    fs.mkdirSync(destination, { recursive: true });
    if (process.platform === 'win32') {
      const a = archive.replace(/'/g,"''"), d = destination.replace(/'/g,"''");
      const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${a}'); try { foreach($e in $z.Entries){ if($e.Name -and -not $e.FullName.StartsWith('META-INF/')){ $o=Join-Path '${d}' $e.Name; [IO.Compression.ZipFileExtensions]::ExtractToFile($e,$o,$true) } } } finally { $z.Dispose() }`;
      await this.exec('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command',script], destination);
      return;
    }
    const tmp = path.join(destination, `.native-${Date.now()}`);
    fs.mkdirSync(tmp,{recursive:true});
    await this.exec('unzip',['-oq',archive,'-d',tmp],destination);
    for (const name of fs.readdirSync(tmp,{recursive:true})) {
      const src=path.join(tmp,name); if(fs.existsSync(src) && fs.statSync(src).isFile() && !String(name).startsWith('META-INF')) fs.copyFileSync(src,path.join(destination,path.basename(src)));
    }
    fs.rmSync(tmp,{recursive:true,force:true});
  }

  exec(command, args, cwd, options = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn(command, args, { cwd, windowsHide: true });
      let settled = false;
      const started = Date.now();
      const timeoutMs = Number(options.timeoutMs || 0);
      const heartbeatMs = Number(options.heartbeatMs || 0);
      let timeout = null;
      let heartbeat = null;
      timeout = timeoutMs ? setTimeout(() => {
        if (settled) return;
        settled = true;
        if (heartbeat) clearInterval(heartbeat);
        try { p.kill(); } catch {}
        reject(new Error(`${path.basename(command)} excedeu o limite de ${Math.round(timeoutMs/60000)} minuto(s). Tente novamente; arquivos jÃ¡ baixados serÃ£o reaproveitados.`));
      }, timeoutMs) : null;
      heartbeat = heartbeatMs ? setInterval(() => {
        const elapsed = Date.now() - started;
        this.log(`Ainda trabalhando: ${path.basename(command)} (${Math.floor(elapsed/1000)}s)...`, 'INFO');
        try { options.heartbeat?.(elapsed); } catch {}
      }, heartbeatMs) : null;
      const done = (fn) => value => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (heartbeat) clearInterval(heartbeat);
        fn(value);
      };
      p.stdout.on('data', d => { const t=String(d).trim(); if (t) this.log(t, 'JAVA'); });
      p.stderr.on('data', d => { const t=String(d).trim(); if (t) this.log(t, 'JAVA'); });
      p.on('error', done(reject));
      p.on('exit', code => done(code === 0 ? resolve : reject)(code === 0 ? undefined : new Error(`${path.basename(command)} encerrou com cÃ³digo ${code}`)));
    });
  }

  async syncDistribution() {
    // O modpack remoto Ã© baixado para %APPDATA%/.minecraft; nÃ£o tente reorganizar
    // a pasta mods ao lado do executÃ¡vel, que pode estar em Program Files.
    const remoteManifest = this.config.distribution?.manifestUrl || '';
    if (!remoteManifest || remoteManifest.includes('SEU-DOMINIO')) this.sanitizeLocalMods();
    const local = this.scanLocalMods();
    const url = this.config.distribution?.manifestUrl || '';
    if (!url || url.includes('SEU-DOMINIO')) {
      await this.syncLocalModsToGame();
      const refreshed = this.scanLocalMods({ silent: true });
      this.progress(`Mods locais prontos (${refreshed.count})`, 80);
      this.log('Mods sincronizados da pasta do VilaNexo Launcher para o Minecraft.', 'SUCESSO');
      return refreshed;
    }
    this.progress('Sincronizando modpack', 65); this.log('Verificando mods, configs e recursos do servidor...');
    const manifest = await this.fetchJson(url);
    const previous = fs.existsSync(this.paths.managedFile) ? JSON.parse(fs.readFileSync(this.paths.managedFile,'utf8')) : { files: [] };
    const wanted = new Set((manifest.files || []).map(f => f.path.replace(/\\/g,'/')));
    const gameModsDir = this.getGameModsDir();
    fs.mkdirSync(gameModsDir, { recursive: true });
    for (const name of fs.readdirSync(gameModsDir)) {
      const rel = `mods/${name}`;
      if (name.toLowerCase().endsWith('.jar') && !wanted.has(rel)) {
        fs.rmSync(path.join(gameModsDir, name), { force: true });
        this.log(`Mod removido pelo manifesto do site: ${name}`, 'INFO');
      }
    }
    for (const old of (previous.files || [])) {
      const rel = old.path.replace(/\\/g,'/');
      if (!wanted.has(rel)) { const abs = path.join(this.paths.gameDir, rel); if (abs.startsWith(this.paths.gameDir)) fs.rmSync(abs, { force: true }); }
    }
    let i=0;
    for (const file of (manifest.files || [])) {
      const safe = file.path.replace(/\\/g,'/').replace(/^\/+/, '');
      const abs = path.resolve(this.paths.gameDir, safe);
      if (!abs.startsWith(path.resolve(this.paths.gameDir) + path.sep)) throw new Error(`Caminho invÃ¡lido no manifesto: ${file.path}`);
      await this.download(file.url, abs, null, file.sha256 || null);
      i++; this.progress(`Sincronizando arquivos (${i}/${manifest.files.length})`, 65 + Math.round(15*i/Math.max(1,manifest.files.length)));
    }
    fs.writeFileSync(this.paths.managedFile, JSON.stringify(manifest, null, 2));
    this.log(`Modpack sincronizado (${manifest.files?.length || 0} arquivos).`, 'SUCESSO');
    this.scanLocalMods({ silent: true });
    return this.state.mods;
  }

  async readResolvedVersion(id) {
    const childPath = path.join(this.paths.gameDir, 'versions', id, `${id}.json`);
    const child = JSON.parse(fs.readFileSync(childPath, 'utf8'));
    if (!child.inheritsFrom) return child;

    const parentPath = path.join(this.paths.gameDir, 'versions', child.inheritsFrom, `${child.inheritsFrom}.json`);
    const parent = JSON.parse(fs.readFileSync(parentPath, 'utf8'));

    // IMPORTANTE PARA FORGE MODERNO (1.17+):
    // O JSON filho do Forge define seu PRÃ“PRIO module-path (-p), ignoreList,
    // add-modules e add-opens. Herdar os argumentos JVM do Minecraft vanilla
    // injeta um segundo "-cp ${classpath}" e cria pacotes duplicados no
    // ModuleLayer (erros "Modules client/minecraft export package ...").
    // O launcher oficial herda os argumentos DE JOGO do pai, mas para Forge
    // usamos a lista JVM do filho exatamente como o instalador a gerou.
    const isModernForge = /-forge-/i.test(String(id)) || /bootstraplauncher/i.test(String(child.mainClass || ''));
    const parentGame = parent.arguments?.game || [];
    const childGame = child.arguments?.game || [];
    const parentJvm = parent.arguments?.jvm || [];
    const childJvm = child.arguments?.jvm || [];

    return {
      ...parent,
      ...child,
      libraries: this.mergeLibraries(parent.libraries || [], child.libraries || []),
      arguments: {
        game: [...parentGame, ...childGame],
        jvm: isModernForge && childJvm.length ? [...childJvm] : [...parentJvm, ...childJvm]
      },
      assetIndex: child.assetIndex || parent.assetIndex,
      assets: child.assets || parent.assets,
      downloads: child.downloads || parent.downloads,
      _parentVersionId: child.inheritsFrom,
      _modernForge: isModernForge
    };
  }

  libraryIdentity(lib) {
    if (!lib) return '';
    if (lib.name) {
      const parts = String(lib.name).split(':');
      // group:artifact[:classifier] identifica a posiÃ§Ã£o lÃ³gica. A versÃ£o do
      // filho deve substituir a do pai quando o Forge fixa outra versÃ£o.
      return `${parts[0] || ''}:${parts[1] || ''}:${parts[3] || ''}`;
    }
    return lib.downloads?.artifact?.path || JSON.stringify(lib);
  }

  mergeLibraries(parent, child) {
    const out = [];
    const index = new Map();
    for (const lib of [...parent, ...child]) {
      const key = this.libraryIdentity(lib);
      if (key && index.has(key)) out[index.get(key)] = lib;
      else {
        if (key) index.set(key, out.length);
        out.push(lib);
      }
    }
    return out;
  }

  libraryPathFromName(name) {
    // Maven coordinate: group:artifact:version[:classifier][@extension]
    const raw = String(name || '');
    const [coord, extPart] = raw.split('@');
    const parts = coord.split(':');
    const group = parts[0], artifact = parts[1], version = parts[2], classifier = parts[3];
    const ext = extPart || 'jar';
    if (!group || !artifact || !version) return null;
    const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
    return path.join(group.replace(/\./g, '/'), artifact, version, file);
  }

  async ensureResolvedLibraries(vjson) {
    const libsDir = path.join(this.paths.gameDir, 'libraries');
    const jobs = [];
    for (const lib of vjson.libraries || []) {
      if (!this.ruleAllowed(lib.rules)) continue;
      if (lib.downloads?.artifact) {
        const artifact = lib.downloads.artifact;
        if (artifact.url && artifact.path) jobs.push({ url: artifact.url, dest: path.join(libsDir, artifact.path), sha1: artifact.sha1 });
      } else if (lib.name) {
        const rel = this.libraryPathFromName(lib.name);
        if (!rel) continue;
        const base = lib.url || 'https://libraries.minecraft.net/';
        jobs.push({ url: base + rel.replace(/\\/g, '/'), dest: path.join(libsDir, rel) });
      }
    }
    await this.runPool(jobs, job => this.download(job.url, job.dest, job.sha1));
  }

  async buildLaunch(javaPath, auth, id) {
    const v = await this.readResolvedVersion(id);
    await this.ensureResolvedLibraries(v);

    const natives = path.join(this.paths.gameDir, 'natives', id);
    fs.rmSync(natives, { recursive: true, force: true });
    fs.mkdirSync(natives, { recursive: true });

    const libsDir = path.join(this.paths.gameDir, 'libraries');
    const cp = [];
    const { platform } = this.platformInfo();

    for (const lib of v.libraries || []) {
      if (!this.ruleAllowed(lib.rules)) continue;
      const rel = lib.downloads?.artifact?.path || (lib.name ? this.libraryPathFromName(lib.name) : null);
      if (rel) {
        const abs = path.join(libsDir, rel);
        if (fs.existsSync(abs)) cp.push(abs);
      }

      const nativeKey = lib.natives?.[platform];
      const nativeArtifact = nativeKey && lib.downloads?.classifiers?.[nativeKey];
      if (nativeArtifact?.path) {
        const zpath = path.join(libsDir, nativeArtifact.path);
        if (fs.existsSync(zpath)) await this.extractNativeArchive(zpath, natives);
      }
    }

    // Para versÃµes herdadas (Forge), o "version jar" continua sendo o JAR do
    // Minecraft pai. NÃƒO adicione manualmente client-*-srg.jar: o Forge jÃ¡
    // declara suas bibliotecas e seu module-path no version.json. Adicionar o
    // SRG manualmente foi a causa dos mÃ³dulos "client" + "minecraft" duplicados.
    const baseVersion = v._parentVersionId || this.config.minecraft.version;
    const versionJar = path.join(this.paths.gameDir, 'versions', baseVersion, `${baseVersion}.jar`);
    if (!fs.existsSync(versionJar)) throw new Error(`JAR base do Minecraft nÃ£o encontrado: ${versionJar}`);
    cp.unshift(versionJar);

    const seen = new Set();
    const dedupedCp = cp.filter(p => {
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sep = process.platform === 'win32' ? ';' : ':';
    const classpath = dedupedCp.join(sep);
    // Minecraft usa ${version_name} com significados diferentes em contextos diferentes.
    // Nos argumentos JVM do Forge, ${version_name} PRECISA ser a versÃ£o base do Minecraft
    // (ex.: 1.20.1), pois o -DignoreList inclui ${version_name}.jar. Se usarmos o id
    // do perfil Forge aqui, 1.20.1.jar deixa de ser ignorado pelo BootstrapLauncher e
    // vira um mÃ³dulo automÃ¡tico (_1._20._1), duplicando o mÃ³dulo 'minecraft'.
    // Nos argumentos de jogo, --version pode continuar usando o id completo do perfil Forge.
    const commonVars = {
      '${auth_player_name}': auth.profile.name,
      '${game_directory}': this.paths.gameDir,
      '${assets_root}': path.join(this.paths.gameDir, 'assets'),
      '${assets_index_name}': v.assetIndex?.id || v.assets || this.config.minecraft.version,
      '${auth_uuid}': auth.profile.id,
      '${auth_access_token}': auth.access_token,
      '${auth_session}': `token:${auth.access_token}:${auth.profile.id}`,
      '${user_type}': auth.offline ? 'legacy' : 'msa',
      '${version_type}': v.type || 'release',
      '${natives_directory}': natives,
      '${launcher_name}': 'VilaNexoLauncher',
      '${launcher_version}': '1.6.0',
      '${classpath}': classpath,
      '${classpath_separator}': sep,
      '${library_directory}': libsDir,
      '${auth_xuid}': auth.xuid || '',
      '${clientid}': ''
    };
    const jvmVars = { ...commonVars, '${version_name}': baseVersion };
    const gameVars = { ...commonVars, '${version_name}': id };

    const expandWith = (value, table) => {
      let out = String(value);
      for (const [key, val] of Object.entries(table)) out = out.split(key).join(String(val));
      return out;
    };

    const flatten = (arr, table) => {
      const out = [];
      for (const item of arr || []) {
        if (typeof item === 'string') out.push(expandWith(item, table));
        else {
          if (item?.rules && !this.ruleAllowed(item.rules)) continue;
          if (item?.value) {
            if (Array.isArray(item.value)) out.push(...item.value.map(v => expandWith(v, table)));
            else out.push(expandWith(item.value, table));
          }
        }
      }
      return out;
    };

    const gameArgs = v.arguments?.game
      ? flatten(v.arguments.game, gameVars)
      : (v.minecraftArguments || '').split(/\s+/).filter(Boolean).map(v => expandWith(v, gameVars));
    const gameDirIndex = gameArgs.findIndex(arg => arg === '--gameDir' || arg === '--game-directory');
    if (gameDirIndex < 0) gameArgs.push('--gameDir', this.paths.gameDir);
    else gameArgs[gameDirIndex + 1] = this.paths.gameDir;
    for (let i = gameArgs.length - 1; i >= 0; i--) if (String(gameArgs[i]).startsWith('--gameDir=')) gameArgs[i] = `--gameDir=${this.paths.gameDir}`;
    const jvmArgs = v.arguments?.jvm ? flatten(v.arguments.jvm, jvmVars) : [];

    // Nunca herdar/injetar um -cp extra antes de conferir o JSON Forge.
    const hasCp = jvmArgs.some(a => a === '-cp' || a === '-classpath' || a.startsWith('-cp='));
    const hasNativePath = jvmArgs.some(a => a.startsWith('-Djava.library.path='));
    if (!hasNativePath) jvmArgs.push(`-Djava.library.path=${natives}`);
    if (!hasCp) jvmArgs.push('-cp', classpath);

    // Sanidade: Forge moderno precisa ter sÃ³ UM classpath e o module-path
    // fornecido pelo JSON filho. Se o pai vazar para cÃ¡, abortamos com um erro
    // claro em vez de abrir um Minecraft condenado a ResolutionException.
    const cpCount = jvmArgs.filter(a => a === '-cp' || a === '-classpath').length;
    if (cpCount !== 1) throw new Error(`Launch Forge invÃ¡lido: foram encontrados ${cpCount} argumentos de classpath. Esperado: 1.`);
    if (v._modernForge) {
      const hasModulePath = jvmArgs.some(a => a === '-p' || a === '--module-path' || a.startsWith('--module-path='));
      if (!hasModulePath) throw new Error('Launch Forge invÃ¡lido: o version.json instalado nÃ£o contÃ©m module-path (-p). Reinstale o Forge pelo launcher.');
      const ignoreArg = jvmArgs.find(a => a.startsWith('-DignoreList=')) || '';
      const expectedVanilla = `${baseVersion}.jar`;
      if (!ignoreArg.toLowerCase().includes(expectedVanilla.toLowerCase())) {
        throw new Error(`Launch Forge invÃ¡lido: ignoreList nÃ£o contÃ©m ${expectedVanilla}. O Minecraft vanilla seria carregado como mÃ³dulo duplicado.`);
      }
      this.log(`Forge bootstrap validado: ${expectedVanilla} estÃ¡ no ignoreList; mÃ³dulo vanilla duplicado bloqueado.`, 'SUCESSO');
    }

    const memory = [`-Xms${this.config.minecraft.memoryMinMb}M`, `-Xmx${this.config.minecraft.memoryMaxMb}M`];
    const performanceArgs = {
      balanced: ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=200'],
      performance: ['-XX:+UseG1GC', '-XX:+UseStringDeduplication', '-XX:MaxGCPauseMillis=100'],
      quality: ['-XX:+UseG1GC', '-XX:MaxGCPauseMillis=300']
    }[this.config.minecraft.performance || 'balanced'];
    // MantÃ©m o servidor salvo no Multiplayer e conecta diretamente ao clicar em Jogar.
    if (this.config.minecraft.serverAddress && !this.config.minecraft.serverAddress.includes('SEU-IP')) {
      gameArgs.push('--server', this.config.minecraft.serverAddress, '--port', String(this.config.minecraft.serverPort || 25565));
    }

    const debug = {
      generatedAt: new Date().toISOString(),
      versionId: id,
      parentVersion: v._parentVersionId || null,
      mainClass: v.mainClass,
      modernForge: !!v._modernForge,
      classpathEntries: dedupedCp.length,
      classpathHasVanillaJar: dedupedCp.some(x => path.resolve(x).toLowerCase() === path.resolve(versionJar).toLowerCase()),
      classpathHasManualSrgJar: false,
      jvmVersionName: baseVersion,
      gameVersionName: id,
      ignoreList: jvmArgs.find(a => a.startsWith('-DignoreList=')) || null,
      jvmArgs,
      gameArgs: gameArgs.map(x => /accessToken/i.test(x) ? '********' : x)
    };
    try { fs.writeFileSync(path.join(this.paths.root, 'ultimo-launch.json'), JSON.stringify(debug, null, 2), 'utf8'); } catch {}

    this.log(`Launch ${(this.config.minecraft.loader || 'Fabric').toUpperCase()} preparado com ${dedupedCp.length} entradas no classpath.`, 'SUCESSO');
    return { command: javaPath, args: [...memory, ...performanceArgs, ...jvmArgs, v.mainClass, ...gameArgs] };
  }

  nbtUtf(value) {
    const data = Buffer.from(String(value), 'utf8');
    const len = Buffer.alloc(2); len.writeUInt16BE(data.length, 0);
    return Buffer.concat([len, data]);
  }

  nbtNamedString(name, value) {
    return Buffer.concat([Buffer.from([8]), this.nbtUtf(name), this.nbtUtf(value)]);
  }

  nbtNamedByte(name, value) {
    return Buffer.concat([Buffer.from([1]), this.nbtUtf(name), Buffer.from([value ? 1 : 0])]);
  }

  ensureVilaNexoServerEntry() {
    const serverName = this.profile.name || 'VilaNexo';
    const serverIp = this.config.minecraft.serverAddress || 'poke.vilanexo.com';
    const port = Number(this.config.minecraft.serverPort || 25565);
    const address = serverIp === 'poke.vilanexo.com' || port === 25565 ? serverIp : `${serverIp}:${port}`;

    ensureServerEntry(path.join(this.paths.gameDir, 'servers.dat'), serverName, address, [`${serverIp}:${port}`]);
    this.log(`Servidor salvo no Multiplayer: ${serverName} (${address}).`, 'SUCESSO');
  }

  ensureNativeServerListScript() {
    const scriptDir = path.join(this.paths.gameDir, 'kubejs', 'client_scripts');
    const scriptPath = path.join(scriptDir, 'vilanexo-server-list.js');
    const script = `const ServerList = Java.loadClass('net.minecraft.client.multiplayer.ServerList');
const ServerData = Java.loadClass('net.minecraft.client.multiplayer.ServerData');

let vilanexoServerSaved = false;

ClientEvents.tick(event => {
  if (vilanexoServerSaved || !event.client) return;

  const servers = new ServerList(event.client);
  servers.load();
  if (!servers.get('${this.config.minecraft.serverAddress}:${this.config.minecraft.serverPort}')) {
    servers.add(new ServerData('VilaNexo', '${this.config.minecraft.serverAddress}:${this.config.minecraft.serverPort}', false), false);
    servers.save();
  }
  vilanexoServerSaved = true;
});
`;
    fs.mkdirSync(scriptDir, { recursive: true });
    if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, 'utf8') !== script) {
      fs.writeFileSync(scriptPath, script, 'utf8');
    }
    this.log('Script nativo do Minecraft preparado para salvar VilaNexo.', 'SUCESSO');
  }

  async play(profileId = 'cobblemon') {
    if (this.state.busy) return;
    this.activateProfile(profileId);
    this.setBusy(true);
    try {
      const auth = await this.refreshAuthIfNeeded();
      if (this.profile.requiresDiscordLogin === true) {
        this.ensureDiscordLogin();
      }
      // A whitelist is required only for the RPG server. Cobblemon still
      // requires Discord login, but does not require whitelist approval.
      if (this.profile.requiresWhitelist === true) {
        await this.verifyDiscordAccess();
      }
      await this.importExistingMinecraft();
       const java = await this.ensureJava21();
       await this.installVanilla();
       const loader = (this.config.minecraft.loader || 'forge').toLowerCase();
        const profileId = loader === 'fabric' ? await this.ensureFabric() : loader === 'neoforge' ? await this.ensureNeoForge(java) : await this.ensureForge(java);
       await this.syncDistribution();
       if (this.profileId === 'cobblemon') migrateMapConfig(this.paths.gameDir);
        await this.ensureCustomSkinLoader();
        this.ensureCustomSkinLoaderConfig();
       try { await this.syncServerSkins(); }
       catch (e) { this.log(`Sincronização de skins indisponível: ${e.message}`, 'AVISO'); }
       finally { this.restoreSavedSkin(auth.profile.name); }
        this.ensureVilaNexoServerEntry();
      this.progress('Iniciando jogo', 95);
       const launch = await this.buildLaunch(java, auth, profileId);
      this.log('Iniciando Minecraft...', 'SUCESSO');
       // O Windows pode injetar _JAVA_OPTIONS/JAVA_TOOL_OPTIONS no Java. Essas
       // opções externas podem sobrescrever o Xms/Xmx do launcher (a imagem
       // mostrava _JAVA_OPTIONS=-Xmx1024M) e fazer a VM abortar na inicialização.
       // O launcher já controla a memória do perfil, então remova-as somente
       // do processo do Minecraft, sem alterar as variáveis do sistema.
       const gameEnv = { ...process.env };
       delete gameEnv._JAVA_OPTIONS;
       delete gameEnv.JAVA_TOOL_OPTIONS;
       delete gameEnv.JDK_JAVA_OPTIONS;
       const p = spawn(launch.command, launch.args, { cwd: this.paths.gameDir, detached: false, windowsHide: false, env: gameEnv });
       p.stdout.on('data', d=>this.log(String(d).trim(),'JOGO'));
       p.stderr.on('data', d=>this.log(String(d).trim(),'JOGO'));
       p.on('exit', code=>this.log(`Minecraft encerrado com cÃ³digo ${code}.`, code===0?'INFO':'ERRO'));
      this.progress('Jogo iniciado', 100);
      return true;
    } catch (e) {
      this.log(e.message || String(e), 'ERRO'); throw e;
    } finally { this.setBusy(false); }
  }
}

module.exports = { LauncherService };

