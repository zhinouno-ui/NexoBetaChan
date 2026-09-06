'use strict';

function registerAgentIpc({ ipcMain, agents, automation, verification, backends, automationRequests, verificationRequests }) {
  ipcMain.handle('drex:navigate', async (_event, url) => {
    await agents.navigate(url || backends.current.url);
    return { ok: true };
  });

  // Asegura que la ventana de agentes EXISTE (creándola hidden si hace falta) pero NO la muestra.
  // Usado por automatizaciones (cargas, búsquedas) que solo necesitan que el webContents esté cargado.
  ipcMain.handle('drex:open-agent-window', (_event, url) => {
    const win = agents.get(url || backends.current.url);
    if (url && win.webContents.getURL() !== url) win.loadURL(url);
    return { ok: true };
  });

  // Trae al frente la ventana de agentes (uso manual: botón "Abrir backoffice").
  ipcMain.handle('drex:show-agent-window', (_event, url) => {
    const win = agents.get(url || backends.current.url);
    if (url && win.webContents.getURL() !== url) win.loadURL(url);
    win.show();
    win.focus();
    return { ok: true };
  });

  // Ejecuta un método de automatización en el backoffice
  ipcMain.handle('drex:automation', async (_event, { method, args = [] } = {}) => {
    return automation.send(method, ...args);
  });

  ipcMain.handle('agent:get-backend', backends.info);
  ipcMain.handle('agent:set-backend', (_event, { backend } = {}) => {
    const result = backends.select(backend);
    if (!result.ok || result.sinCambio) return result;
    try { agents.close(); } catch (_) {}
    try { verification.close(); } catch (_) {}
    try { const win = agents.get(); win.show(); win.focus(); } catch (_) {}
    console.log('[agent-backend] cambiado a', backend, '→', backends.current.url);
    return result;
  });
  ipcMain.on('drex:automation:result', (_event, response = {}) => automationRequests.settle(response, 'Error en automatización.'));
  ipcMain.handle('drex:verify-user', (_event, { usuario } = {}) => verification.send(usuario));
  ipcMain.on('drex:verify:result', (_event, response = {}) => verificationRequests.settle(response, 'Error en verificación.'));

  return {  };
}

module.exports = { registerAgentIpc };
