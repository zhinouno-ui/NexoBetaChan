'use strict';

function registerUpdaterIpc({ ipcMain, app, BrowserWindow, shell, panel, env = process.env, autoUpdater = null, loadUpdater = () => require('electron-updater').autoUpdater }) {
  const UPDATE_CHANNELS = {
    alpha: { owner: 'admimaster26-collab', repo: 'nodo-panel',   label: 'Alpha · oficial' },
    beta:  { owner: 'zhinouno-ui',         repo: 'NexoBetaChan',  label: 'Beta · pruebas' }
  };
  (function(){
    const parse = s => { const p = String(s||'').split('/'); return (p[0] && p[1]) ? { owner:p[0], repo:p[1] } : null; };
    const a = parse(env.UPDATER_ALPHA), b = parse(env.UPDATER_BETA);
    if (a) { UPDATE_CHANNELS.alpha.owner = a.owner; UPDATE_CHANNELS.alpha.repo = a.repo; }
    if (b) { UPDATE_CHANNELS.beta.owner  = b.owner; UPDATE_CHANNELS.beta.repo  = b.repo; }
  })();
  let _updaterChannel = 'alpha'; // canal activo (lo fija el renderer en cada check)
  try {
    if (!autoUpdater) autoUpdater = loadUpdater();
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
  } catch (_e) { console.warn('[updater] electron-updater no disponible:', _e && _e.message); }
  function _sendUpdaterStatus(event, payload) {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) || panel.current;
      if (win) win.webContents.send('updater:status', payload);
    } catch (_e) {}
  }

  ipcMain.handle('updater:version', () => ({ ok: true, version: app.getVersion() }));

  ipcMain.handle('updater:check', async (event, arg) => {
    if (!autoUpdater) return { ok: false, reason: 'no-updater' };
    if (!app.isPackaged) return { ok: false, reason: 'dev-mode' };
    // Canal elegido por el renderer (persistido en el panel). Default: el último usado.
    const canal = (arg && arg.channel && UPDATE_CHANNELS[arg.channel]) ? arg.channel : _updaterChannel;
    _updaterChannel = canal;
    const repo = UPDATE_CHANNELS[canal];
    try {
      autoUpdater.removeAllListeners();
      autoUpdater.on('checking-for-update', () => _sendUpdaterStatus(event, { state: 'checking', channel: canal }));
      autoUpdater.on('update-available',    (info) => _sendUpdaterStatus(event, { state: 'available', version: info && info.version, channel: canal }));
      autoUpdater.on('update-not-available',() => _sendUpdaterStatus(event, { state: 'not-available', channel: canal }));
      autoUpdater.on('error', (err) => _sendUpdaterStatus(event, { state: 'error', message: String(err && err.message || err), channel: canal }));
      autoUpdater.on('download-progress', (p) => _sendUpdaterStatus(event, { state: 'downloading', percent: Math.round(p && p.percent || 0) }));
      autoUpdater.on('update-downloaded', (info) => _sendUpdaterStatus(event, { state: 'downloaded', version: info && info.version, channel: canal }));
      // Cada canal es una FUENTE distinta (repo distinto). Sin cruce automático.
      autoUpdater.setFeedURL({ provider: 'github', owner: repo.owner, repo: repo.repo });
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r && r.updateInfo && r.updateInfo.version, channel: canal, repo: repo.owner + '/' + repo.repo };
    } catch (e) {
      console.warn('[updater] check falló · canal', canal, '(' + repo.owner + '/' + repo.repo + ') ·', e && e.message);
      return { ok: false, reason: 'error', channel: canal, message: String(e && e.message || e) };
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (!autoUpdater) return { ok: false };
    try { await autoUpdater.downloadUpdate(); return { ok: true }; }
    catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  });

  ipcMain.handle('updater:install', () => {
    if (!autoUpdater) return { ok: false };
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });

  // "Volver a la versión anterior": abre la página de releases en el navegador, donde la oficina
  // puede bajar cualquier instalador previo si esta versión falla. Es la salida de emergencia
  // más confiable (un downgrade automático de electron-updater es frágil).
  ipcMain.handle('updater:open-releases', async () => {
    try { const repo = UPDATE_CHANNELS[_updaterChannel] || UPDATE_CHANNELS.alpha; await shell.openExternal('https://github.com/' + repo.owner + '/' + repo.repo + '/releases'); return { ok: true }; }
    catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  });

  return {  };
}

module.exports = { registerUpdaterIpc };
