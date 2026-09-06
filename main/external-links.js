'use strict';

function registerExternalLinksIpc({ ipcMain, shell }) {
  const EXTERNO_OK = new Set(['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'github.com']);
  ipcMain.handle('app:abrir-externo', async (_event, url) => {
    try {
      const u = new URL(String(url || ''));
      if (u.protocol !== 'https:') return { ok: false, message: 'SOLO_HTTPS' };
      if (!EXTERNO_OK.has(u.hostname)) return { ok: false, message: 'DOMINIO_NO_PERMITIDO: ' + u.hostname };
      await shell.openExternal(u.toString());
      return { ok: true };
    } catch (e) { return { ok: false, message: String(e && e.message || e) }; }
  });

  return {  };
}

module.exports = { registerExternalLinksIpc };
