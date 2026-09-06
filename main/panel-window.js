'use strict';
const path = require('node:path');

function createPanelWindow({ BrowserWindow, rootDir, icon }) {
  let mainWindow = null;
  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width:    1440,
      height:   900,
      minWidth: 900,
      minHeight:600,
      title: 'NODO · OPERATIVO',
      icon:  icon,
      backgroundColor: '#0e1014', // evita el flash blanco mientras carga / al despertar
      webPreferences: {
        preload:               path.join(rootDir, 'app-preload.js'),
        contextIsolation:      true,
        nodeIntegration:       false,
        webviewTag:            true,
        backgroundThrottling:  false, // que JS siga corriendo aunque la ventana no esté enfocada
      }
    });

    mainWindow.loadFile('NODO · OPERATIVO LITE.htm');
    mainWindow.on('closed', () => { mainWindow = null; });

    // Recovery: si el renderer se cuelga / crashea (esto causa la pantalla blanca)
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      console.error('[main] render-process-gone:', details);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    });
    mainWindow.webContents.on('unresponsive', () => {
      console.warn('[main] renderer unresponsive — forcing reload');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    });

    // Zoom Ctrl+= / Ctrl+- / Ctrl+0 (teclado)
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (!input.control || input.type !== 'keyDown') return;
      const key = input.key;
      if (key === '=' || key === '+' || key === 'NumpadAdd') {
        const f = mainWindow.webContents.getZoomFactor();
        mainWindow.webContents.setZoomFactor(Math.min(parseFloat((f + 0.1).toFixed(1)), 3.0));
        event.preventDefault();
      } else if (key === '-' || key === 'NumpadSubtract') {
        const f = mainWindow.webContents.getZoomFactor();
        mainWindow.webContents.setZoomFactor(Math.max(parseFloat((f - 0.1).toFixed(1)), 0.3));
        event.preventDefault();
      } else if (key === '0') {
        mainWindow.webContents.setZoomFactor(1.0);
        event.preventDefault();
      }
    });

    // Zoom Ctrl+Rueda del mouse
    mainWindow.webContents.on('zoom-changed', (_event, direction) => {
      const f = mainWindow.webContents.getZoomFactor();
      if (direction === 'in')
        mainWindow.webContents.setZoomFactor(Math.min(parseFloat((f + 0.1).toFixed(1)), 3.0));
      else
        mainWindow.webContents.setZoomFactor(Math.max(parseFloat((f - 0.1).toFixed(1)), 0.3));
    });

    // Habilitar zoom visual (trackpad pinch)
    mainWindow.webContents.setVisualZoomLevelLimits(1, 5);
  }

  function refocus() { try { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.blur(); mainWindow.focus(); } } catch (_) {} return { ok: true }; }

  return { create: createMainWindow, get current() { return mainWindow; }, refocus };
}

module.exports = { createPanelWindow };
