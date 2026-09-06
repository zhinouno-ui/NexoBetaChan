'use strict';

function registerPanelIpc({ ipcMain, env = process.env, fetch = globalThis.fetch }) {
  async function panelRpcRestFetchV154Plus(fn, params = {}) {
    const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const key = String(env.SUPABASE_ANON_KEY || env.SUPABASE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
    if (!url || !key) {
      return { data: null, error: { message: "Falta SUPABASE_URL o SUPABASE_ANON_KEY en .env" } };
    }

    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "apikey": key,
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(params || {})
      });

      const txt = await res.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (_e) { data = txt; }

      if (!res.ok) {
        return {
          data: null,
          error: {
            message: (data && (data.message || data.error || data.hint)) || `HTTP ${res.status}`,
            status: res.status,
            details: data
          }
        };
      }

      return { data, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message || String(e) } };
    }
  }

  // Whitelist de RPC que el HTML puede invocar por panelAPI.rpc (lectura de Portal/Chat).
  // Igual que ALLOWED_AUTOMATION_METHODS: evita que un bug/XSS en el renderer llame RPCs no previstas.
  const PANEL_RPC_ALLOW = new Set([
    'landing_crear_chat_v2',
    'panel_nodo_send_chat_message',
    'panel_v15_5_listar_solicitudes_portal',
    'panel_v15_5_actualizar_solicitud_portal',
    'landing_retiro_registrar_parcial',
    'panel_core_get_chat_sesiones_json',
    'panel_v154_plus_listar_chat_sesiones',
    'panel_core_get_chat_mensajes_json',
    'panel_v154_plus_get_chat_mensajes',
    'panel_core_enviar_chat_json',
    'panel_v154_plus_enviar_chat',
    // CRM · reconexión y prevalidación (v1.1.61)
    'panel_reconexion_cola',
    'panel_reconexion_marcar',
    'panel_reconexion_unificar',
    'panel_reconexion_limpiar_seguros',
    'panel_dormidos',
    'panel_crm_perfil_v1',
    'panel_telefonos_de_usuario',
    'panel_v14_cerrar_chat_json',
    'panel_v14_reabrir_chat_json',
    'panel_guardar_datos_retiro',
    'panel_usuarios_contacto',
    'panel_prevalidar_usuario'
  ]);

  ipcMain.handle('panel:rpc', async (_event, arg1, arg2 = {}) => {
    let fn = arg1;
    let params = arg2 || {};

    if (arg1 && typeof arg1 === "object") {
      fn = arg1.fn || arg1.function || arg1.rpc || arg1.name || arg1.procedure;
      params = arg1.params || arg1.payload || arg1.args || {};
    }

    if (!fn || typeof fn !== "string") {
      return { data: null, error: { message: "RPC_INVALID_FN", details: { received: arg1 } } };
    }

    if (!PANEL_RPC_ALLOW.has(fn)) {
      console.warn('[panel:rpc] RPC no permitida:', fn);
      return { data: null, error: { message: "RPC_NO_PERMITIDA: " + fn } };
    }

    return await panelRpcRestFetchV154Plus(fn, params || {});
  });

  ipcMain.handle('panel:ping' , async () => ({
    ok: true,
    bridge: "panelAPI",
    version: "V15",
    ts: new Date().toISOString()
  }));

  ipcMain.handle('panel:get-context', async () => ({
    ok: true,
    pc_codigo:     env.PC_CODIGO || env.LANDING_PC_CODIGO || "",
    landing_pc:    env.LANDING_PC_CODIGO || env.PC_CODIGO || "",
    session_id:    Number(env.PANEL_SESSION_ID || 0),
    chunior_pt_id: env.CHUNIOR_PT_ID || null,
    operador_usuario: env.OPERADOR_USUARIO || "",
    operador_nombre:  env.OPERADOR_NOMBRE  || "",
    // PRODUCCIÓN: ya NO se exponen supabase_url/supabase_key acá (el renderer no los usa; tiene su
    // propio cliente con la anon key PÚBLICA). Lo ideal es migrar más lecturas a panelAPI.rpc.
  }));

  return { rpc: panelRpcRestFetchV154Plus };
}

module.exports = { registerPanelIpc };
