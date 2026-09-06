'use strict';

function createProxyService({ app, session, env = process.env }) {
  function envBoolV15(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return ["1", "true", "si", "sí", "yes", "on"].includes(String(value).trim().toLowerCase());
  }

  function proxyRulesFromEnvV15() {
    const enabled = envBoolV15(env.PROXY_ENABLED, false);
    if (!enabled) return "";

    const host = String(env.PROXY_HOST || "").trim();
    const port = String(env.PROXY_PORT || "").trim();
    const protocol = String(env.PROXY_PROTOCOL || "http").trim().toLowerCase();

    if (!host || !port) return "";

    if (protocol.startsWith("socks")) return `socks=${host}:${port}`;
    return `http=${host}:${port};https=${host}:${port}`;
  }

  // Sesión DEDICADA de Agentes (casinodrex). El proxy se aplica SOLO acá; Chunior, Supabase y el
  // resto (sesión default) NUNCA se ven afectados por el proxy ni por el closeAllConnections
  // (antes cortaba las conexiones de Chunior → pestaña en blanco / fallo). Igual que el NODO hermano.
  const AGENT_PARTITION = 'persist:nodo-agentes';
  function agentSes() { return session.fromPartition(AGENT_PARTITION); }

  async function configurarProxyElectronV15() {
    const enabled = envBoolV15(env.PROXY_ENABLED, false);
    if (!enabled) {
      console.log("[proxy] DESACTIVADO");
      return { ok: true, enabled: false };
    }

    const proxyRules = proxyRulesFromEnvV15();
    if (!proxyRules) {
      console.warn("[proxy] Activado, pero falta PROXY_HOST / PROXY_PORT.");
      return { ok: false, enabled: true, error: "Falta PROXY_HOST / PROXY_PORT" };
    }

    // Proxy SOLO en la sesión de Agentes → no toca Chunior/Supabase.
    await agentSes().setProxy({
      mode: "fixed_servers",
      proxyRules,
      proxyBypassRules: env.PROXY_BYPASS_RULES || "<local>"
    });
    _proxyApplied = true;

    try { await agentSes().closeAllConnections(); } catch (_e) {}

    console.log("[proxy] ACTIVADO (sesión agentes):", proxyRules);
    return { ok: true, enabled: true, proxyRules };
  }

  // Proxy aplicado en RUNTIME: config por oficina, traída del admi tras el login en Chunior.
  let _runtimeProxyAuth = null; // {username, password} para el evento "login" del proxy
  let _proxyApplied = false;    // si hay un proxy fixed_servers activo
  async function aplicarProxyRuntime(cfg) {
    try {
      cfg = cfg || {};
      if (!cfg.enabled || !cfg.host || !cfg.port) {
        _runtimeProxyAuth = null;
        // Sin proxy: SOLO limpiamos si antes había uno activo (solo la sesión de Agentes).
        if (_proxyApplied) {
          await agentSes().setProxy({ mode: "direct" });
          try { await agentSes().closeAllConnections(); } catch (_e) {}
          _proxyApplied = false;
          console.log("[proxy] runtime: limpiado (salida directa)");
        }
        return { ok: true, enabled: false };
      }
      const protocol = String(cfg.protocol || "http").toLowerCase();
      const rules = protocol.startsWith("socks")
        ? `socks=${cfg.host}:${cfg.port}`
        : `http=${cfg.host}:${cfg.port};https=${cfg.host}:${cfg.port}`;
      // Proxy SOLO en la sesión de Agentes → Chunior y Supabase (sesión default) intactos.
      await agentSes().setProxy({
        mode: "fixed_servers",
        proxyRules: rules,
        proxyBypassRules: cfg.bypass || "<local>"
      });
      try { await agentSes().closeAllConnections(); } catch (_e) {}
      _proxyApplied = true;
      _runtimeProxyAuth = cfg.username ? { username: String(cfg.username), password: String(cfg.password || "") } : null;
      console.log("[proxy] runtime ACTIVADO:", rules);
      return { ok: true, enabled: true, proxyRules: rules };
    } catch (e) {
      console.warn("[proxy] runtime error:", e.message);
      return { ok: false, error: e.message };
    }
  }

  app.on("login", (event, webContents, request, authInfo, callback) => {
    if (!authInfo?.isProxy) return;
    // Prioridad: creds de runtime (por oficina, traídas del admi). Fallback: .env.
    if (_runtimeProxyAuth && _runtimeProxyAuth.username) {
      event.preventDefault();
      callback(_runtimeProxyAuth.username, _runtimeProxyAuth.password || "");
      return;
    }
    if (envBoolV15(env.PROXY_ENABLED, false) && env.PROXY_USERNAME) {
      event.preventDefault();
      callback(String(env.PROXY_USERNAME || ""), String(env.PROXY_PASSWORD || ""));
    }
  });

  return { configure: configurarProxyElectronV15, apply: aplicarProxyRuntime, getSession: agentSes, partition: AGENT_PARTITION };
}

module.exports = { createProxyService };
