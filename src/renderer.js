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

function renderHomeSkin(dataUrl) {
  const side = document.querySelector('#homeSkinPanel, .dashboard-side');
  if (!side || !window.skinview3d?.SkinViewer) return;
  let panel = document.getElementById('homeSkin3d');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'homeSkin3d';
     panel.className = 'home-skin-3d';
    panel.innerHTML = '<canvas id="homeSkinCanvas"></canvas><button type="button" data-page="skins">Editar Skin</button>';
     side.appendChild(panel);
    panel.querySelector('button').onclick = () => showPage('skins');
    homeSkinViewer = new window.skinview3d.SkinViewer({ canvas: $('homeSkinCanvas'), width: 250, height: 210, skin: dataUrl || 'https://minotar.net/skin/Steve' });
    homeSkinViewer.background = null;
    homeSkinViewer.fov = 38;
    homeSkinViewer.zoom = .72;
    homeSkinViewer.autoRotate = true;
    if (homeSkinViewer.globalLight) homeSkinViewer.globalLight.intensity = 2.4;
    if (homeSkinViewer.cameraLight) homeSkinViewer.cameraLight.intensity = .45;
  } else if (dataUrl && homeSkinViewer) {
    homeSkinViewer.loadSkin(dataUrl, { model: $('skinVariant')?.value === 'slim' ? 'slim' : 'default' });
  }
  if (!document.getElementById('creatorCard')) {
    const card = document.createElement('button');
    card.id = 'creatorCard';
    card.className = 'creator-card';
    card.type = 'button';
    card.innerHTML = '<span class="youtube-mark">▶</span><span><small>CRIADOR DO LAUNCHER</small><strong>ApenasTyron</strong><em>Visite meu canal no YouTube</em></span><b>›</b>';
    card.onclick = () => window.vilaNexoLauncher.openUrl('https://www.youtube.com/@ApenasTyron');
    side.appendChild(card);
  }
}

function logLine(e) {
  const box = $('logBox');
  box.textContent += `[${e.time}] [${e.level}] ${e.message}\n`;
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
    $('modsSummary').textContent = `${modsCatalog.length} mods • ${manifest.version || 'versão atual'}`;
    renderModsList();
  } catch (e) {
    $('modsSummary').textContent = 'Lista indisponível';
    $('modsList').innerHTML = '<div class="mods-empty">Não foi possível carregar a lista de mods agora.</div>';
    logLine({ time:new Date().toLocaleTimeString('pt-BR'), level:'INFO', message:'Não foi possível carregar a lista de mods.' });
  }
}

function updateState(s) {
  document.querySelectorAll('.server-choice button').forEach(b => { b.disabled = !!s.busy; });
  updateMods(s.mods);
  if (s.account) {
    $('profileName').textContent = s.account.name;
    if ($('dashboardProfileName')) $('dashboardProfileName').textContent = s.account.name;
    $('profileWelcome').textContent = `Bem-vindo, ${s.account.name}! Boa aventura.`;
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
  if (persist) localStorage.setItem('vilanexo-theme', normalized);
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
    skinViewer3D.fov = 42;
    skinViewer3D.zoom = 0.78;
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
    viewer.zoom = 0.78;
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
  if (!savedSkin?.dataUrl) return;
  document.querySelector('.dashboard-side')?.style.setProperty('--skin-image', `url("${savedSkin.dataUrl}")`);
  $('skinOfflineName').value = savedSkin.name;
  $('skinCurrentName').textContent = savedSkin.name;
  $('skinFileName').textContent = 'Skin salva carregada automaticamente.';
  selectedSkin = { path: null, name: savedSkin.name, dataUrl: savedSkin.dataUrl };
  renderSkin3D(savedSkin.dataUrl);
  renderHomeSkin(savedSkin.dataUrl);
  $('uploadSkin').disabled = true;
}

function setupSkinInteraction() {
  // O skinview3d usa OrbitControls do Three.js: rotação e zoom são 3D de verdade.
  // Não usamos mais cubos CSS nem transformações 2D simuladas.
}

function setSkinView(view) {
  if (!skinViewer3D) return;
  const player = skinViewer3D.playerObject;
  if (player) {
    const rotations = { front:0, back:Math.PI, left:Math.PI/2, right:-Math.PI/2, reset:-Math.PI/7 };
    if (view in rotations) player.rotation.y = rotations[view];
  }
  const cam = skinViewer3D.camera;
  if (cam) {
    if (view === 'top') cam.position.set(0, 45, 24);
    else if (view === 'bottom') cam.position.set(0, -18, 35);
    else cam.position.set(0, 0, 42);
    cam.lookAt(0, 16, 0);
  }
  skinViewer3D.zoom = (view === 'top' || view === 'bottom') ? 0.68 : 0.78;
  document.querySelectorAll('[data-skin-view]').forEach(b => b.classList.toggle('active', b.dataset.skinView === view || (view === 'reset' && b.dataset.skinView === 'front')));
}

async function init() {
  config = await window.vilaNexoLauncher.getConfig();
  const state = await window.vilaNexoLauncher.getState();
  updateState(state);
  renderHomeSkin();
    $('configSummary').textContent = `Minecraft: ${config.minecraft.version}\nLoader: ${(config.minecraft.loader || 'Fabric').toUpperCase()} ${config.minecraft.loaderVersion || ''}\nMemória: ${config.minecraft.memoryMinMb}–${config.minecraft.memoryMaxMb} MB\nServidor: VilaNexo Cobblemon\nIP: ${config.minecraft.serverAddress}:${config.minecraft.serverPort}`;
   $('memoryMinMb').value = config.minecraft.memoryMinMb || 2048;
   $('memoryMaxMb').value = config.minecraft.memoryMaxMb || 6144;
   $('performanceMode').value = config.minecraft.performance || 'balanced';
  applyTheme(localStorage.getItem('vilanexo-theme') || '#8d46ff', false);
  setupSkinInteraction();
  logLine({ time:new Date().toLocaleTimeString('pt-BR'), level:'INFO', message:'Launcher iniciado.' });
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
  if ($('modsSearch')) $('modsSearch').oninput = e => renderModsList(e.target.value);
  if (state.account?.name) {
    await loadSavedSkin(state.account.name);
  }
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
$('loginOffline').onclick = async () => { try { const profile = await window.vilaNexoLauncher.loginOffline($('offlineName').value); await loadSavedSkin(profile.name); } catch (e) { alert(e.message); } };
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
$('logout').onclick = async () => { await window.vilaNexoLauncher.logout(); updateState(await window.vilaNexoLauncher.getState()); };
if ($('folderGame')) $('folderGame').onclick = () => window.vilaNexoLauncher.openGame();
if ($('folderLogs')) $('folderLogs').onclick = () => window.vilaNexoLauncher.openLogs();
if ($('store')) $('store').onclick = () => window.vilaNexoLauncher.openUrl(config.links.store);
if ($('support')) $('support').onclick = () => window.vilaNexoLauncher.openUrl(config.links.support);

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
      if ($('skinMiniHead')) { $('skinMiniHead').style.backgroundImage = `url("${f.dataUrl}")`; $('skinMiniHead').style.backgroundSize = '464px 464px'; $('skinMiniHead').style.backgroundPosition = '-58px -58px'; $('skinMiniHead').querySelector('span').style.display='none'; }
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
    const variant = btn.dataset.variant;
    $('skinVariant').value = variant;
    document.querySelectorAll('.model-choice').forEach(b => b.classList.toggle('active', b === btn));
    if (skinDataUrl) renderSkin3D(skinDataUrl);
  };
});

$('uploadSkin').onclick = async () => {
  if (!selectedSkin) return;
  const btn = $('uploadSkin');
  try {
    btn.disabled = true;
    $('skinMessage').textContent = 'Aplicando skin...';
    const r = await window.vilaNexoLauncher.uploadSkin(selectedSkin.path, $('skinVariant').value, $('skinOfflineName').value);
    $('skinMessage').textContent = `Skin aplicada para ${r.name}. Reentre no jogo para atualizar.`;
  } catch (e) { $('skinMessage').textContent = `Erro: ${e.message}`; }
  finally { btn.disabled = false; }
};


if ($('skinOfflineName')) $('skinOfflineName').addEventListener('input', () => { if ($('skinCurrentName')) $('skinCurrentName').textContent = $('skinOfflineName').value || 'Perfil VilaNexo'; });
$('launcherColor').oninput = e => applyTheme(e.target.value);
document.querySelectorAll('.theme-presets button').forEach(b => b.onclick = () => applyTheme(b.dataset.color));
$('resetTheme').onclick = () => applyTheme('#8d46ff');

$('clearLogs').onclick = () => $('logBox').textContent = '';
$('saveSettings').onclick = async () => {
  const button = $('saveSettings');
  try {
    button.disabled = true;
    config = await window.vilaNexoLauncher.updateSettings({ memoryMinMb: $('memoryMinMb').value, memoryMaxMb: $('memoryMaxMb').value, performance: $('performanceMode').value });
    $('settingsMessage').textContent = 'Configurações salvas. Elas serão usadas no próximo jogo.';
    $('configSummary').textContent = `Minecraft: ${config.minecraft.version}\nLoader: ${(config.minecraft.loader || 'Fabric').toUpperCase()} ${config.minecraft.loaderVersion || ''}\nMemória: ${config.minecraft.memoryMinMb}–${config.minecraft.memoryMaxMb} MB\nServidor: VilaNexo Cobblemon\nIP: ${config.minecraft.serverAddress}:${config.minecraft.serverPort}`;
  } catch (e) { $('settingsMessage').textContent = e.message; }
  finally { button.disabled = false; }
};
window.vilaNexoLauncher.onLog(logLine);
window.vilaNexoLauncher.onMods(updateMods);
window.vilaNexoLauncher.onProgress(p => {
  if ($('bar')) $('bar').style.width = `${p.progress}%`;
  if ($('phase')) $('phase').textContent = p.phase;
  if ($('status')) $('status').textContent = `● ${p.phase}`;
  logLine({ time: new Date().toLocaleTimeString('pt-BR'), level: 'INFO', message: `${p.phase} (${Math.round(p.progress)}%)` });
});
window.vilaNexoLauncher.onState(updateState);

init();
