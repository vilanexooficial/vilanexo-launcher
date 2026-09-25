const $ = (id) => document.getElementById(id);
let config;
let selectedSkin = null;
let skinDataUrl = '';
let modelRotX = -7;
let modelRotY = 24;
let modelScale = 1.02;
let dragging = false;
let lastX = 0;
let lastY = 0;
let skinViewer3D = null;
let skinViewerResizeObserver = null;
let discordPollTimer = null;
let homeSkinViewer = null;
let selectedProfile = 'cobblemon';
let modsCatalog = [];
const DEFAULT_SKIN = '../assets/default-skin.png';
let currentAccount = null;

function drawHead(dataUrl, el, size = 42) {
  if (!el || !dataUrl) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
    if (img.height >= 64) g.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
    el.textContent = '';
    el.style.background = 'none';
    el.appendChild(c);
  };
  img.src = dataUrl;
}

function renderHomeSkin(dataUrl) {
  const side = document.getElementById('homeSkinPanel');
  if (!side) return;
  if (dataUrl) { drawHead(dataUrl, $('profileHead'), 42); drawHead(dataUrl, $('skinMiniHead'), 46); drawHead(dataUrl, $('accountHead'), 64); }
  if (!window.skinview3d?.SkinViewer) return;
  let panel = document.getElementById('homeSkin3d');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'homeSkin3d';
    panel.className = 'home-skin-3d';
    panel.innerHTML = '<canvas id="homeSkinCanvas"></canvas>';
    side.insertBefore(panel, $('profileHint'));
    const r = panel.getBoundingClientRect();
    homeSkinViewer = new window.skinview3d.SkinViewer({ canvas: $('homeSkinCanvas'), width: Math.max(200, Math.round(r.width)), height: Math.max(220, Math.round(r.height)), skin: dataUrl || DEFAULT_SKIN, model: $('skinVariant')?.value === 'slim' ? 'slim' : 'default' });
    homeSkinViewer.background = null;
    homeSkinViewer.fov = 40;
    homeSkinViewer.camera.position.set(0, .18, 1);
    homeSkinViewer.zoom = .68;
    homeSkinViewer.autoRotate = true;
    homeSkinViewer.autoRotateSpeed = .55;
    if (homeSkinViewer.controls) { homeSkinViewer.controls.enableZoom = false; homeSkinViewer.controls.enablePan = false; }
    if (homeSkinViewer.globalLight) homeSkinViewer.globalLight.intensity = 2.4;
    if (homeSkinViewer.cameraLight) homeSkinViewer.cameraLight.intensity = .5;
    try { if (window.skinview3d.IdleAnimation) homeSkinViewer.animation = new window.skinview3d.IdleAnimation(); } catch {}
    new ResizeObserver(() => {
      const b = panel.getBoundingClientRect();
      if (b.width > 10 && b.height > 10) { homeSkinViewer.width = Math.round(b.width); homeSkinViewer.height = Math.round(b.height); }
    }).observe(panel);
  } else if (dataUrl && homeSkinViewer) {
    homeSkinViewer.loadSkin(dataUrl, { model: $('skinVariant')?.value === 'slim' ? 'slim' : 'default' });
  }
  if (!document.getElementById('creatorCard')) {
    const card = document.createElement('button');
    card.id = 'creatorCard';
    card.className = 'creator-card';
    card.type = 'button';
    card.innerHTML = '<span class="youtube-mark">▶</span><span><small>CRIADOR DO LAUNCHER</small><strong>ApenasTyron</strong><em>Visite o canal no YouTube</em></span><b>›</b>';
    card.onclick = () => window.vilaNexoLauncher.openUrl('https://www.youtube.com/@ApenasTyron');
    side.appendChild(card);
  }
}

async function refreshServerStatus() {
  const tag = $('heroStatus');
  if (!tag) return;
  const host = config?.minecraft?.serverAddress || 'poke.vilanexo.com';
  const port = config?.minecraft?.serverPort || 25566;
  try {
    const r = await fetch(`https://api.mcsrvstat.us/3/${host}:${port}`, { cache: 'no-store' });
    const d = await r.json();
    if (d.online) {
      const on = d.players?.online ?? 0;
      tag.innerHTML = `<i class="pulse"></i><b>Online • ${on} ${on === 1 ? 'jogador' : 'jogadores'}</b>`;
      if ($('heroPlayers')) $('heroPlayers').textContent = on;
    } else {
      tag.innerHTML = '<i class="pulse off"></i><b>Servidor reiniciando</b>';
      if ($('heroPlayers')) $('heroPlayers').textContent = '0';
    }
  } catch {
    tag.innerHTML = '<i class="pulse wait"></i><b>Servidor online</b>';
  }
}

function logLine(e) {
  const box = $('logBox');
  if (!box) return;
  box.append(document.createTextNode(`[${e.time}] [${e.level}] ${e.message}\n`));
  while (box.childNodes.length > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active-page'));
  $(id).classList.add('active-page');
  document.querySelectorAll('nav [data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  if (id === 'skins' && skinViewer3D) {
    requestAnimationFrame(() => skinViewerResizeObserver?.callback?.());
  }
}

function updateMods(m) {
  if (!$('modsStatus')) return;
  $('modsStatus').textContent = `${m?.count || 0} mod(s) sincronizado(s)`;
}

function prettyModName(path) {
  const file = decodeURIComponent(String(path || '').split('/').pop() || 'Mod');
  return file.replace(/\.jar$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function renderModsList(filter = '') {
  const list = $('modsList');
  if (!list) return;
  const term = filter.trim().toLowerCase();
  const visible = modsCatalog.filter(mod => mod.name.toLowerCase().includes(term) || mod.file.toLowerCase().includes(term));
  list.textContent = '';
  if (!visible.length) { list.innerHTML = '<div class="mods-empty">Nenhum mod encontrado.</div>'; return; }
  visible.forEach(mod => {
    const card = document.createElement('article');
    card.className = 'mod-card';
    card.dataset.initial = (mod.name.match(/[a-z0-9]/i) || ['M'])[0].toUpperCase();
    let hue = 0; for (const ch of mod.name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    card.style.setProperty('--hue', hue);
    const name = document.createElement('strong');
    name.textContent = mod.name;
    const file = document.createElement('small');
    file.textContent = mod.file;
    card.append(name, file);
    list.appendChild(card);
  });
}

async function loadModsCatalog() {
  if (!$('modsList')) return;
  try {
    const url = config.profiles?.cobblemon?.distribution?.manifestUrl || config.distribution?.manifestUrl;
    const manifest = await fetch(`${url}${url.includes('?') ? '&' : '?'}launcher=${Date.now()}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    modsCatalog = (manifest.files || []).filter(f => /^mods\//i.test(f.path || '')).map(f => ({ name: prettyModName(f.path), file: decodeURIComponent(String(f.path).split('/').pop()) }));
    $('modsSummary').textContent = `${modsCatalog.length} mods • pacote ${manifest.version || 'atual'}`;
    if ($('heroMods')) $('heroMods').textContent = modsCatalog.length;
    renderModsList();
  } catch (e) {
    $('modsSummary').textContent = 'Lista indisponível';
    $('modsList').innerHTML = '<div class="mods-empty">Não foi possível carregar a lista de mods agora.</div>';
    logLine({ time:new Date().toLocaleTimeString('pt-BR'), level:'INFO', message:'Não foi possível carregar a lista de mods.' });
  }
}

function updateState(s) {
  document.querySelectorAll('.server-choice button').forEach(b => { b.disabled = !!s.busy || !!s.gameRunning; });
  document.body.classList.toggle('busy', !!s.busy);
  updateMods(s.mods);
  const prevId = currentAccount?.id;
  currentAccount = s.account || null;
  if ($('accountName')) {
    $('accountName').textContent = s.account ? s.account.name : 'Nenhuma conta';
    const badge = $('accountType');
    badge.className = 'acc-badge' + (s.account ? (s.account.type === 'microsoft' ? ' ms' : ' local') : '');
    badge.textContent = !s.account ? 'Entre com Microsoft ou escolha um nick abaixo.' : s.account.type === 'microsoft' ? '● Minecraft original (conta Microsoft)' : '● Perfil com nick (não original)';
  }
  if (s.account && prevId && prevId !== s.account.id) { skinDataUrl = ''; loadSavedSkin(s.account.name); }
  if (s.account) {
    $('profileName').textContent = s.account.name;
    if ($('dashboardProfileName')) $('dashboardProfileName').textContent = s.account.name;
    $('profileWelcome').textContent = s.account.type === 'microsoft' ? 'Minecraft original' : 'Perfil com nick';
    if ($('skinOfflineName') && !$('skinOfflineName').value) $('skinOfflineName').value = s.account.name;
    if ($('offlineName') && !$('offlineName').value) $('offlineName').value = s.account.name;
  } else {
    $('profileName').textContent = 'VilaNexo';
    if ($('dashboardProfileName')) $('dashboardProfileName').textContent = 'VilaNexo';
    $('profileWelcome').textContent = 'Bem-vindo ao VilaNexo!';
  }
  if ($('discordStatus')) $('discordStatus').textContent = s.discord ? `Discord conectado: ${s.discord.username || s.discord.id}` : 'Discord não conectado.';
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(h)) return { r: 141, g: 70, b: 255 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function lighten(hex, amount = 0.25) {
  const { r, g, b } = hexToRgb(hex);
  const mix = v => Math.round(v + (255 - v) * amount).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

function applyTheme(hex, persist = true) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '#8d46ff';
  const { r, g, b } = hexToRgb(normalized);
  document.documentElement.style.setProperty('--p', normalized);
  document.documentElement.style.setProperty('--p2', lighten(normalized, 0.33));
  document.documentElement.style.setProperty('--accent-rgb', `${r},${g},${b}`);
  $('launcherColor').value = normalized;
  $('launcherColorValue').textContent = normalized.toUpperCase();
  document.querySelectorAll('.theme-presets button').forEach(b => b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === normalized));
  if (persist) { try { localStorage.setItem('vilanexo-theme', normalized); } catch {} }
}

function ensureSkinViewer() {
  if (!window.skinview3d || !window.skinview3d.SkinViewer) {
    throw new Error('Motor 3D ainda não carregou. Verifique a internet e abra a aba Skins novamente.');
  }
  const canvas = $('skinCanvas');
  const stage = $('skin3d');
  if (!skinViewer3D) {
    const rect = stage.getBoundingClientRect();
    skinViewer3D = new window.skinview3d.SkinViewer({
      canvas,
      width: Math.max(320, Math.round(rect.width)),
      height: Math.max(360, Math.round(rect.height)),
      skin: skinDataUrl || undefined
    });
    skinViewer3D.background = null;
    skinViewer3D.fov = 40;
    skinViewer3D.zoom = 0.86;
    try { if (window.skinview3d.IdleAnimation) skinViewer3D.animation = new window.skinview3d.IdleAnimation(); } catch {}
    skinViewer3D.autoRotate = false;
    if (skinViewer3D.globalLight) skinViewer3D.globalLight.intensity = 2.6;
    if (skinViewer3D.cameraLight) skinViewer3D.cameraLight.intensity = 0.45;
    if (skinViewer3D.controls) {
      skinViewer3D.controls.enableRotate = true;
      skinViewer3D.controls.enableZoom = true;
      skinViewer3D.controls.enablePan = false;
    }
    skinViewerResizeObserver = new ResizeObserver(() => {
      if (!skinViewer3D) return;
      const r = stage.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        skinViewer3D.width = Math.round(r.width);
        skinViewer3D.height = Math.round(r.height);
      }
    });
    skinViewerResizeObserver.observe(stage);
  }
  return skinViewer3D;
}

function renderSkin3D(dataUrl) {
  skinDataUrl = dataUrl;
  $('skinPlaceholder').classList.add('hidden');
  try {
    const viewer = ensureSkinViewer();
    const model = $('skinVariant').value === 'slim' ? 'slim' : 'default';
    viewer.loadSkin(dataUrl, { model });
    setSkinView('reset');
    $('skinMessage').textContent = 'Preview WebGL 3D real ativo. Arraste para girar e use o scroll para zoom.';
  } catch (e) {
    $('skinPlaceholder').classList.remove('hidden');
    $('skinPlaceholder').innerHTML = `<div><b>Motor 3D indisponível</b><span>${e.message}</span></div>`;
    $('skinMessage').textContent = e.message;
  }
}

async function loadSavedSkin(name) {
  const savedSkin = await window.vilaNexoLauncher.getSavedSkin(name);
  if (!savedSkin?.dataUrl) { useDefaultSkin(); return; }
  if (savedSkin.variant) setVariant(savedSkin.variant === 'slim' ? 'slim' : 'classic');
  document.querySelector('.dashboard-side')?.style.setProperty('--skin-image', `url("${savedSkin.dataUrl}")`);
  $('skinOfflineName').value = savedSkin.name;
  $('skinCurrentName').textContent = savedSkin.name;
  $('skinFileName').textContent = savedSkin.official ? 'Skin oficial da sua conta Microsoft.' : 'Skin salva carregada automaticamente.';
  selectedSkin = { path: null, name: savedSkin.name, dataUrl: savedSkin.dataUrl };
  renderSkin3D(savedSkin.dataUrl);
  renderHomeSkin(savedSkin.dataUrl);
  $('uploadSkin').disabled = true;
}

function setVariant(variant) {
  $('skinVariant').value = variant;
  document.querySelectorAll('.model-choice').forEach(b => b.classList.toggle('active', b.dataset.variant === variant));
}

function useDefaultSkin() {
  if (skinDataUrl) return;
  renderHomeSkin(DEFAULT_SKIN);
  if ($('skinPlaceholder') && window.skinview3d?.SkinViewer) {
    renderSkin3D(DEFAULT_SKIN);
    skinDataUrl = '';
    $('skinMessage').textContent = 'Skin padrão do VilaNexo. Escolha um PNG para usar a sua.';
  }
}

function setupSkinInteraction() {
  // O skinview3d usa OrbitControls do Three.js: rotação e zoom são 3D de verdade.
  // Não usamos mais cubos CSS nem transformações 2D simuladas.
}

function setSkinView(view) {
  const v = skinViewer3D;
  if (!v) return;
  const turn = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2, reset: -Math.PI / 7, top: -Math.PI / 7, bottom: -Math.PI / 7 };
  if (v.playerWrapper) v.playerWrapper.rotation.set(0, 0, 0);
  if (v.playerObject) v.playerObject.rotation.set(0, turn[view] ?? 0, 0);
  const dir = view === 'top' ? [0, 1.25, 1] : view === 'bottom' ? [0, -1, 1] : [0, .12, 1];
  v.camera.position.set(dir[0], dir[1], dir[2]);
  v.camera.rotation.set(0, 0, 0);
  if (v.controls?.target) v.controls.target.set(0, 0, 0);
  v.zoom = (view === 'top' || view === 'bottom') ? 0.72 : 0.86;
  v.camera.lookAt(0, 0, 0);
  v.controls?.update();
  document.querySelectorAll('[data-skin-view]').forEach(b => b.classList.toggle('active', b.dataset.skinView === view || (view === 'reset' && b.dataset.skinView === 'front')));
}

async function init() {
  config = await window.vilaNexoLauncher.getConfig();
  const state = await window.vilaNexoLauncher.getState();
  updateState(state);
  renderHomeSkin();
    $('configSummary').textContent = `Minecraft: ${config.minecraft.version}\nLoader: ${(config.minecraft.loader || 'neoforge').toUpperCase()} ${config.minecraft.loaderVersion || ''}\nMemória: ${config.minecraft.memoryMinMb}–${config.minecraft.memoryMaxMb} MB\nServidor: VilaNexo Cobblemon\nIP: ${config.minecraft.serverAddress}:${config.minecraft.serverPort}`;
   $('memoryMinMb').value = config.minecraft.memoryMinMb || 2048;
   $('memoryMaxMb').value = config.minecraft.memoryMaxMb || 6144;
   $('memoryMaxSlider').value = config.minecraft.memoryMaxMb || 6144;
   $('ramValue').textContent = `${((config.minecraft.memoryMaxMb || 6144) / 1024).toFixed(1).replace('.0', '')} GB`;
   $('launcherDisplayVersion').textContent = config.launcher?.displayVersion || '1.0';
   $('performanceMode').value = config.minecraft.performance || 'balanced';
  let savedTheme = null; try { savedTheme = localStorage.getItem('vilanexo-theme'); } catch {}
  applyTheme(savedTheme || '#8d46ff', false);
  setupSkinInteraction();
  if ($('closeOnPlay')) {
    $('closeOnPlay').checked = config.closeOnPlay !== false;
    $('closeOnPlay').onchange = async (e) => { try { await window.vilaNexoLauncher.setCloseOnPlay(e.target.checked); } catch {} };
  }
  const back = new URLSearchParams(location.search);
  if (back.get('back')) {
    const code = back.get('code');
    const ok = code === '0' || code === null;
    logLine({ time: new Date().toLocaleTimeString('pt-BR'), level: ok ? 'INFO' : 'ERRO', message: ok ? 'Minecraft fechado. Bem-vindo de volta!' : `O Minecraft fechou com erro (código ${code}). Se continuar, abra a pasta Logs e mande no Discord.` });
    if ($('status')) $('status').textContent = ok ? '● Bem-vindo de volta' : '● O jogo fechou com erro';
  } else {
    logLine({ time:new Date().toLocaleTimeString('pt-BR'), level:'INFO', message:'Launcher iniciado.' });
  }
  window.vilaNexoLauncher.onUpdate((update) => {
    if (update.event === 'available') {
      $('updateText').textContent = `Baixando a versão ${update.version} automaticamente...`;
      $('updateNotice').classList.remove('hidden');
    } else if (update.event === 'progress') {
      $('updateText').textContent = `Atualização em andamento (${Math.round(update.percent)}%)...`;
      $('updateNotice').classList.remove('hidden');
    } else if (update.event === 'downloaded') {
      $('updateText').textContent = `Versão ${update.version} pronta para instalar. O launcher será atualizado ao reiniciar.`;
      $('updateNotice').classList.remove('hidden');
      $('updateLauncher').textContent = 'Reiniciar e atualizar';
      $('updateLauncher').onclick = () => window.vilaNexoLauncher.installUpdate();
    }
  });
  loadModsCatalog();
  refreshServerStatus();
  setInterval(refreshServerStatus, 60000);
  if ($('modsSearch')) $('modsSearch').oninput = e => renderModsList(e.target.value);
  if (state.account?.name) {
    await loadSavedSkin(state.account.name);
  } else useDefaultSkin();
}

document.querySelectorAll('nav [data-page]').forEach(b => b.onclick = () => showPage(b.dataset.page));
$('min').onclick = () => window.vilaNexoLauncher.minimize();
$('max').onclick = () => window.vilaNexoLauncher.maximize();
$('close').onclick = () => window.vilaNexoLauncher.close();
  document.querySelectorAll('.server-choice').forEach(card => {
    card.querySelector('button')?.addEventListener('click', async () => {
      selectedProfile = card.dataset.profile || 'cobblemon';
      document.querySelectorAll('.server-choice').forEach(c => c.classList.toggle('selected', c === card));
      try { await window.vilaNexoLauncher.play(selectedProfile); } catch (e) { alert(e.message); }
    });
  });
$('loginOffline').onclick = async () => { try { const profile = await window.vilaNexoLauncher.loginOffline($('offlineName').value); skinDataUrl = ''; await loadSavedSkin(profile.name); } catch (e) { logLine({ time: new Date().toLocaleTimeString('pt-BR'), level: 'ERRO', message: e.message }); alert(String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } };
$('loginDiscord').onclick = async () => {
  const btn = $('loginDiscord');
  try {
    btn.disabled = true;
    $('discordStatus').textContent = 'Abrindo o Discord no navegador...';
    const { nonce } = await window.vilaNexoLauncher.loginDiscord();
    let tries = 0;
    if (discordPollTimer) clearInterval(discordPollTimer);
    discordPollTimer = setInterval(async () => {
      tries++;
      try {
        const result = await window.vilaNexoLauncher.pollDiscord(nonce);
        if (result?.ok) {
          clearInterval(discordPollTimer);
          discordPollTimer = null;
          btn.disabled = false;
          updateState(await window.vilaNexoLauncher.getState());
        } else if (tries >= 120) {
          clearInterval(discordPollTimer);
          discordPollTimer = null;
          btn.disabled = false;
          $('discordStatus').textContent = 'Tempo de login esgotado. Tente novamente.';
        } else $('discordStatus').textContent = 'Aguardando confirmação do Discord...';
      } catch (e) {
        clearInterval(discordPollTimer);
        discordPollTimer = null;
        btn.disabled = false;
        $('discordStatus').textContent = e.message;
      }
    }, 2000);
  } catch (e) {
    btn.disabled = false;
    $('discordStatus').textContent = e.message;
  }
};
$('logout').onclick = async () => { await window.vilaNexoLauncher.logout(); updateState(await window.vilaNexoLauncher.getState()); if ($('microsoftStatus')) $('microsoftStatus').textContent = 'Uma janela segura da Microsoft vai abrir.'; };
if ($('folderGame')) $('folderGame').onclick = () => window.vilaNexoLauncher.openGame();
if ($('folderLogs')) $('folderLogs').onclick = () => window.vilaNexoLauncher.openLogs();
const openLink = (key, fallback) => () => window.vilaNexoLauncher.openUrl(config?.links?.[key] || fallback);
if ($('store')) $('store').onclick = openLink('store', 'https://www.vilanexo.com/loja');
if ($('quickStore')) $('quickStore').onclick = openLink('store', 'https://www.vilanexo.com/loja');
if ($('linkDiscord')) $('linkDiscord').onclick = openLink('support', 'https://discord.gg/vilanexo');
if ($('quickDiscord')) $('quickDiscord').onclick = openLink('support', 'https://discord.gg/vilanexo');
if ($('linkSite')) $('linkSite').onclick = openLink('wiki', 'https://www.vilanexo.com/');
if ($('quickSite')) $('quickSite').onclick = openLink('wiki', 'https://www.vilanexo.com/');

$('chooseSkin').onclick = async () => {
  try {
    const f = await window.vilaNexoLauncher.chooseSkin();
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      if (!((img.width === 64 && img.height === 64) || (img.width === 64 && img.height === 32))) {
        $('skinMessage').textContent = `A imagem é ${img.width}x${img.height}. O recomendado é 64x64.`;
      } else {
        $('skinMessage').textContent = 'Skin pronta para aplicar. Arraste a prévia para girar.';
      }
       selectedSkin = f;
       renderHomeSkin(f.dataUrl);
       document.querySelector('.dashboard-side')?.style.setProperty('--skin-image', `url("${f.dataUrl}")`);
      $('skinFileName').textContent = f.name;
      if ($('skinCurrentName')) $('skinCurrentName').textContent = $('skinOfflineName').value || 'Perfil VilaNexo';
      drawHead(f.dataUrl, $('skinMiniHead'), 46);
      $('uploadSkin').disabled = false;
      renderSkin3D(f.dataUrl);
    };
    img.src = f.dataUrl;
  } catch (e) { $('skinMessage').textContent = e.message; }
};
$('skinVariant').onchange = () => { if (skinDataUrl) renderSkin3D(skinDataUrl); };


document.querySelectorAll('[data-skin-view]').forEach(btn => {
  btn.onclick = () => setSkinView(btn.dataset.skinView);
});

document.querySelectorAll('.model-choice').forEach(btn => {
  btn.onclick = () => {
    setVariant(btn.dataset.variant);
    if (skinDataUrl) renderSkin3D(skinDataUrl);
    if (homeSkinViewer && skinDataUrl) homeSkinViewer.loadSkin(skinDataUrl, { model: btn.dataset.variant === 'slim' ? 'slim' : 'default' });
  };
});

$('uploadSkin').onclick = async () => {
  if (!selectedSkin) return;
  const btn = $('uploadSkin');
  try {
    btn.disabled = true;
    $('skinMessage').textContent = 'Aplicando skin...';
    const r = await window.vilaNexoLauncher.uploadSkin(selectedSkin.path, $('skinVariant').value, $('skinOfflineName').value);
    $('skinMessage').textContent = r.synced === false
      ? `Skin salva para ${r.name} só neste PC: não deu para enviar ao site (${r.syncError || 'sem conexão'}). Os outros jogadores ainda não vão ver; tente de novo.`
      : `Skin aplicada para ${r.name}! Os outros jogadores veem ao reentrar no servidor.`;
  } catch (e) { $('skinMessage').textContent = `Erro: ${e.message}`; }
  finally { btn.disabled = false; }
};


if ($('skinOfflineName')) $('skinOfflineName').addEventListener('input', () => { if ($('skinCurrentName')) $('skinCurrentName').textContent = $('skinOfflineName').value || 'Perfil VilaNexo'; });
$('launcherColor').oninput = e => applyTheme(e.target.value);
document.querySelectorAll('.theme-presets button').forEach(b => { b.style.background = b.dataset.color; b.onclick = () => applyTheme(b.dataset.color); });
$('themeToggle').onclick = (e) => { e.stopPropagation(); $('themePop').classList.toggle('hidden'); $('themeToggle').classList.toggle('open', !$('themePop').classList.contains('hidden')); };
$('themePop').onclick = e => e.stopPropagation();
document.addEventListener('click', () => { $('themePop').classList.add('hidden'); $('themeToggle').classList.remove('open'); });
document.querySelectorAll('[data-open-settings]').forEach(b => b.onclick = () => { $('themePop').classList.add('hidden'); showPage('settings'); });
$('resetTheme').onclick = () => applyTheme('#8d46ff');
$('loginMicrosoft').onclick = async () => {
  const btn = $('loginMicrosoft');
  try {
    btn.disabled = true;
    $('microsoftStatus').textContent = 'Aguardando você entrar na janela da Microsoft...';
    const acc = await window.vilaNexoLauncher.loginMicrosoft();
    $('microsoftStatus').textContent = `Conectado como ${acc.name}.`;
    skinDataUrl = '';
    await loadSavedSkin(acc.name);
  } catch (e) {
    $('microsoftStatus').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally { btn.disabled = false; }
};

$('clearLogs').onclick = () => $('logBox').textContent = '';
$('saveSettings').onclick = async () => {
  const button = $('saveSettings');
  try {
    button.disabled = true;
    config = await window.vilaNexoLauncher.updateSettings({ memoryMinMb: $('memoryMinMb').value, memoryMaxMb: $('memoryMaxMb').value, performance: $('performanceMode').value });
    $('settingsMessage').textContent = 'Configurações salvas. Elas serão usadas no próximo jogo.';
    $('configSummary').textContent = `Minecraft: ${config.minecraft.version}\nLoader: ${(config.minecraft.loader || 'neoforge').toUpperCase()} ${config.minecraft.loaderVersion || ''}\nMemória: ${config.minecraft.memoryMinMb}–${config.minecraft.memoryMaxMb} MB\nServidor: VilaNexo Cobblemon\nIP: ${config.minecraft.serverAddress}:${config.minecraft.serverPort}`;
  } catch (e) { $('settingsMessage').textContent = e.message; }
  finally { button.disabled = false; }
};
$('memoryMaxSlider').oninput = e => {
  $('memoryMaxMb').value = e.target.value;
  $('ramValue').textContent = `${(Number(e.target.value) / 1024).toFixed(1).replace('.0', '')} GB`;
};
$('memoryMaxMb').oninput = e => {
  const value = Math.max(2048, Math.min(32768, Number(e.target.value) || 6144));
  $('memoryMaxSlider').value = value;
  $('ramValue').textContent = `${(value / 1024).toFixed(1).replace('.0', '')} GB`;
};
window.vilaNexoLauncher.onLog(logLine);
window.vilaNexoLauncher.onMods(updateMods);
window.vilaNexoLauncher.onProgress(p => {
  if ($('bar')) $('bar').style.width = `${p.progress}%`;
  if ($('phase')) $('phase').textContent = p.phase;
  if ($('phasePct')) $('phasePct').textContent = `${Math.round(p.progress || 0)}%`;
  if ($('status')) $('status').textContent = `● ${p.phase}`;
  logLine({ time: new Date().toLocaleTimeString('pt-BR'), level: 'INFO', message: `${p.phase} (${Math.round(p.progress)}%)` });
});
window.vilaNexoLauncher.onState(updateState);

init().catch((e) => {
  console.error(e);
  logLine({ time: new Date().toLocaleTimeString('pt-BR'), level: 'ERRO', message: e && e.message ? e.message : String(e) });
  alert((e && e.message) || 'Não foi possível carregar o launcher. Feche e abra de novo.');
});
