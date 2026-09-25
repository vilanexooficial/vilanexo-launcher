const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { LauncherService } = require('./launcher-service');

let mainWindow;
let launcher;

// --- Autoconserto: se a última abertura não chegou a mostrar a tela (placa de vídeo/driver
// problemático), esta abertura roda sem aceleração de hardware.
const bootFlag = path.join(app.getPath('userData'), 'boot-pendente.flag');
const noGpuFlag = path.join(app.getPath('userData'), 'sem-gpu.flag');
let safeMode = false;
try {
  if (fs.existsSync(noGpuFlag) || fs.existsSync(bootFlag) || process.argv.includes('--sem-gpu')) {
    safeMode = true;
    app.disableHardwareAcceleration();
    fs.writeFileSync(noGpuFlag, new Date().toISOString());
  }
  fs.mkdirSync(path.dirname(bootFlag), { recursive: true });
  fs.writeFileSync(bootFlag, new Date().toISOString());
} catch {}
ipcMain.on('app:ui-ready', () => { try { fs.unlinkSync(bootFlag); } catch {} });
app.on('child-process-gone', (_, details) => {
  if (details.type === 'GPU' && !safeMode) {
    try { fs.writeFileSync(noGpuFlag, new Date().toISOString()); } catch {}
    app.relaunch({ args: process.argv.slice(1).concat(['--sem-gpu']) });
    app.exit(0);
  }
});

function sendUpdate(event, data = {}) {
  mainWindow?.webContents.send('app:update', { event, ...data });
}

function setupAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => sendUpdate('checking'));
  autoUpdater.on('update-available', (info) => sendUpdate('available', { version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate('none'));
  autoUpdater.on('download-progress', (progress) => sendUpdate('progress', { percent: progress.percent }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate('downloaded', { version: info.version }));
  autoUpdater.on('error', (error) => sendUpdate('error', { message: error.message }));
  autoUpdater.checkForUpdates().catch((error) => sendUpdate('error', { message: error.message }));
}

let launcherSleeping = false;
let sleepTimer = null;
let sleepEnabled = false;
let gameChild = null;

function sleepLauncher() {
  if (!mainWindow || mainWindow.isDestroyed() || launcherSleeping) return;
  if (!gameChild || gameChild.exitCode !== null) return;
  launcherSleeping = true;
  mainWindow.hide();
  mainWindow.webContents.loadURL('about:blank');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1180,
    minHeight: 760,
    frame: false,
    backgroundColor: '#120c1d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const makeService = () => new LauncherService({
    app,
    emit: (event, payload) => { if (mainWindow && !mainWindow.isDestroyed() && !launcherSleeping) mainWindow.webContents.send(event, payload); },
    hooks: {
      // Enquanto o Minecraft roda, a interface é descarregada e a janela some,
      // ficando só o processo principal (bem leve). Quando o jogo fecha, volta.
      gameStarted: (child, closeOnPlay) => {
        gameChild = child;
        sleepEnabled = !!closeOnPlay;
        if (!sleepEnabled) return;
        clearTimeout(sleepTimer);
        sleepTimer = setTimeout(sleepLauncher, 30000); // se não detectar a janela do jogo
      },
      gameVisible: () => {
        if (!sleepEnabled) return;
        clearTimeout(sleepTimer);
        sleepTimer = setTimeout(sleepLauncher, 2500);
      },
      gameExited: (code) => {
        clearTimeout(sleepTimer);
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (launcherSleeping) {
          launcherSleeping = false;
          mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { back: '1', code: String(code) } });
        }
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  });

  try {
    launcher = makeService();
  } catch (error) {
    // Arquivos de configuração corrompidos: guarda uma cópia e tenta de novo limpo.
    const root = path.join(app.getPath('appData'), 'VilaNexo');
    for (const f of ['launcher-preferences.json', 'managed-files.json', 'managed-files-cobblemon.json', 'managed-files-rpg.json']) {
      try { fs.renameSync(path.join(root, f), path.join(root, f + '.corrompido-' + Date.now())); } catch {}
    }
    try { launcher = makeService(); }
    catch (again) { dialog.showErrorBox('VilaNexo Launcher', 'Não foi possível iniciar o launcher:\n' + (again && again.message || again) + '\n\nMande um print disso para a equipe VilaNexo.'); }
  }

  mainWindow.webContents.on('render-process-gone', () => {
    if (!mainWindow.isDestroyed() && !launcherSleeping) setTimeout(() => mainWindow.loadFile(path.join(__dirname, 'index.html')), 800);
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (launcherSleeping) {
      launcherSleeping = false;
      mainWindow.loadFile(path.join(__dirname, 'index.html'), { query: { back: '1' } });
    }
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => { createWindow(); setupAutoUpdates(); });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Todo acesso ao serviço passa por aqui: mensagem clara se ele não iniciou.
const svc = () => {
  if (!launcher) throw new Error('O launcher não conseguiu iniciar. Reinstale pelo site (vilanexo.com), de preferência fora de "Arquivos de Programas".');
  return launcher;
};
ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window:close', () => mainWindow.close());

ipcMain.handle('launcher:get-config', () => svc().getPublicConfig());
ipcMain.handle('launcher:set-close-on-play', (_, value) => svc().setCloseOnPlay(value));
ipcMain.handle('launcher:update-settings', (_, settings) => svc().updateSettings(settings));
ipcMain.handle('launcher:get-state', () => svc().getState());
ipcMain.handle('launcher:check-update', () => svc().checkForUpdate());
ipcMain.handle('app:install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('launcher:login-offline', (_, username) => svc().loginOffline(username));
ipcMain.handle('launcher:discord-login', async () => {
  const data = await svc().startDiscordLogin();
  await shell.openExternal(data.loginUrl);
  return { nonce: data.nonce };
});
ipcMain.handle('launcher:microsoft-login', async () => {
  const code = await new Promise((resolve, reject) => {
    const redirect = svc().microsoftConfig().redirectUri;
    const win = new BrowserWindow({
      parent: mainWindow, modal: true, width: 500, height: 680, resizable: false, minimizable: false,
      title: 'Entrar com a conta Microsoft', backgroundColor: '#ffffff', autoHideMenuBar: true,
      webPreferences: { partition: `msa-${Date.now()}`, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    let done = false;
    const finish = (url) => {
      if (done || !String(url).startsWith(redirect)) return false;
      done = true;
      const u = new URL(url);
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error_description') || u.searchParams.get('error');
      setImmediate(() => { if (!win.isDestroyed()) win.close(); });
      if (c) resolve(c); else reject(new Error(err ? `Login Microsoft recusado: ${err}` : 'Login Microsoft cancelado.'));
      return true;
    };
    win.webContents.on('will-redirect', (e, url) => { if (finish(url)) e.preventDefault(); });
    win.webContents.on('will-navigate', (e, url) => { if (finish(url)) e.preventDefault(); });
    win.webContents.on('did-navigate', (_, url) => finish(url));
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    win.on('closed', () => { if (!done) { done = true; reject(new Error('Login Microsoft cancelado.')); } });
    win.loadURL(svc().microsoftAuthorizeUrl());
  });
  return svc().loginMicrosoft(code);
});
ipcMain.handle('launcher:discord-poll', (_, nonce) => svc().pollDiscordLogin(nonce));
ipcMain.handle('launcher:logout', () => svc().logout());
ipcMain.handle('launcher:play', (_, profileId) => svc().play(profileId));
ipcMain.handle('launcher:sync', () => svc().syncDistribution());
ipcMain.handle('launcher:open-game', () => shell.openPath(svc().paths.gameDir));
ipcMain.handle('launcher:open-logs', () => shell.openPath(path.join(svc().paths.gameDir, 'logs')));
ipcMain.handle('launcher:open-url', (_, url) => (/^https:\/\//i.test(String(url)) ? shell.openExternal(url) : null));

ipcMain.handle('launcher:choose-skin', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar skin do Minecraft',
    properties: ['openFile'],
    filters: [{ name: 'Skin Minecraft (PNG)', extensions: ['png'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error('A skin é muito grande. Escolha um PNG de até 2 MB.');
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) throw new Error('O arquivo selecionado não é um PNG válido.');
  return { path: filePath, name: path.basename(filePath), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
});
ipcMain.handle('launcher:upload-skin', (_, data) => svc().uploadSkin(data?.filePath, data?.variant, data?.offlineName));
ipcMain.handle('launcher:get-saved-skin', (_, username) => svc().getSavedSkin(username));
