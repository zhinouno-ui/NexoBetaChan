'use strict';
const fs = require('node:fs');
const path = require('node:path');

function registerNexoIpc({ ipcMain, app }) {
  function _nexoDatosPath() {
    return path.join(app.getPath('appData'), 'nexo-desktop', 'shared', 'nodo-datos.json');
  }
  function _nexoInstalado() {
    try { return fs.existsSync(path.join(app.getPath('appData'), 'nexo-desktop')); } catch (_e) { return false; }
  }
  ipcMain.handle('nexo:estado', async () => {
    try {
      const p = _nexoDatosPath();
      const instalado = _nexoInstalado();
      let existeArchivo = false, bytes = 0, mtime = null;
      try { if (fs.existsSync(p)) { const st = fs.statSync(p); existeArchivo = true; bytes = st.size; mtime = st.mtime.toISOString(); } } catch (_e) {}
      return { ok:true, instalado, path:p, existeArchivo, bytes, mtime };
    } catch (e) { return { ok:false, error: e.message || String(e) }; }
  });
  ipcMain.handle('nexo:write', async (_e, arg = {}) => {
    try {
      if (!_nexoInstalado()) return { ok:false, instalado:false }; // Nexo no está → no escribimos (no estricto)
      const p = _nexoDatosPath();
      const dir = path.dirname(p);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) {} // nodo crea su carpeta shared/
      const content = String(arg && arg.content != null ? arg.content : '');
      const tmp = p + '.tmp-nodo';
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, p); // atómico en el mismo volumen
      return { ok:true, instalado:true, path:p, bytes: Buffer.byteLength(content, 'utf8') };
    } catch (e) { return { ok:false, error: e.message || String(e) }; }
  });

  // Pedidos de Nexo → NODO. Nexo NO puede escribir identidades: la RPC panel_vincular_usuario exige
  // PANEL_DATA_SECRET, y ese secreto no se comparte. Así que Nexo ENCOLA en su propio archivo y NODO
  // aplica con su secreto. Nadie comparte nada y NODO decide qué se escribe.
  // Este handler SOLO LEE. El archivo es de Nexo: no se toca, no se borra, no se reescribe — el
  // acuse va por nodo-datos.json (campo pedidosAplicados), que es el archivo del que NODO es dueño.
  function _nexoPedidosPath() {
    return path.join(app.getPath('appData'), 'nexo-desktop', 'shared', 'nexo-pedidos.json');
  }
  ipcMain.handle('nexo:pedidos', async () => {
    try {
      if (!_nexoInstalado()) return { ok:true, instalado:false, pedidos:[] };
      const p = _nexoPedidosPath();
      if (!fs.existsSync(p)) return { ok:true, instalado:true, pedidos:[] };
      const txt = fs.readFileSync(p, 'utf8');
      let j = null;
      try { j = JSON.parse(txt); } catch (_e) { return { ok:false, error:'JSON inválido en nexo-pedidos.json' }; }
      const pedidos = (j && Array.isArray(j.pedidos)) ? j.pedidos : [];
      return { ok:true, instalado:true, path:p, pc_codigo:(j && j.pc_codigo) || null,
               generatedAt:(j && j.generatedAt) || null, pedidos:pedidos.slice(0, 200) };
    } catch (e) { return { ok:false, error: e.message || String(e) }; }
  });

  return {  };
}

module.exports = { registerNexoIpc };
