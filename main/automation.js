'use strict';

function createAutomationService({ agents, backends, requests, env = process.env }) {
  function automationTimeoutFor(method) {
    const envTimeout = Number(env.DREX_AUTOMATION_TIMEOUT_MS || 0);
    if (envTimeout > 0) return envTimeout;
    // Timeouts ajustados para que un CUELGUE se resuelva rápido y libere al operador (demanda alta).
    // Una carga normal tarda ~10-15s; el timeout libera la espera sin reenviar el movimiento.
    if (method === 'cargarSaldo' || method === 'retirarSaldo') return 45000;   // antes 180s
    if (method === 'crearUsuario' || method === 'cambiarClave') return 55000;  // antes 90s
    if (method === 'buscarUsuario' || method === 'obtenerSaldoAgente') return 28000; // antes 45s
    return 40000; // antes 60s
  }

  function sendAutomation(method, ...args) {
    const win = agents.get();
    // Algunos métodos requieren estar en una URL específica → navegamos primero
    let preNav;
    if      (method === 'buscarUsuario')       preNav = agents.navigate(backends.current.url);
    else if (method === 'crearUsuario')        preNav = agents.navigate(backends.current.newUserUrl, { forceReload: !backends.current.spa }); // BET300 crea por modal, sin recargar
    else if (method === 'obtenerSaldoAgente')  preNav = agents.navigate(backends.current.url);
    else                                       preNav = agents.ready(win);
    return preNav.then(() => {
      return requests.run(win.webContents, 'drex:automation:run', { method, args }, automationTimeoutFor(method), 'Timeout: la automatización tardó demasiado.');
    });
  }

  return { send: sendAutomation, timeoutFor: automationTimeoutFor };
}

module.exports = { createAutomationService };
