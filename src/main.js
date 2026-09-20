const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { LauncherService } = require('./launcher-service');

let mainWindow;
let launcher;

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

  launcher = new LauncherService({
    app,
    emit: (event, payload) => mainWindow?.webContents.send(event, payload)
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => { createWindow(); setupAutoUpdates(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('window:minimize', () => mainWindow.minimize());
ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('window:close', () => mainWindow.close());

ipcMain.handle('launcher:get-config', () => launcher.getPublicConfig());
ipcMain.handle('launcher:get-state', () => launcher.getState());
ipcMain.handle('launcher:check-update', () => launcher.checkForUpdate());
ipcMain.handle('app:install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('launcher:login-offline', (_, username) => launcher.loginOffline(username));
ipcMain.handle('launcher:discord-login', async () => {
  const data = await launcher.startDiscordLogin();
  await shell.openExternal(data.loginUrl);
  return { nonce: data.nonce };
});
ipcMain.handle('launcher:discord-poll', (_, nonce) => launcher.pollDiscordLogin(nonce));
ipcMain.handle('launcher:logout', () => launcher.logout());
ipcMain.handle('launcher:play', (_, profileId) => launcher.play(profileId));
ipcMain.handle('launcher:sync', () => launcher.syncDistribution());
ipcMain.handle('launcher:open-game', () => shell.openPath(launcher.paths.gameDir));
ipcMain.handle('launcher:open-logs', () => shell.openPath(path.join(launcher.paths.gameDir, 'logs')));
ipcMain.handle('launcher:open-url', (_, url) => shell.openExternal(url));

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
ipcMain.handle('launcher:upload-skin', (_, data) => launcher.uploadSkin(data?.filePath, data?.variant, data?.offlineName));
ipcMain.handle('launcher:get-saved-skin', (_, username) => launcher.getSavedSkin(username));
