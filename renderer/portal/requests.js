/* Portal: requests. Factories are inert until create(deps); legacy handlers are returned in globals. */
(function(root, define){
  const api = define();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.NodoPortalRequests = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';
  const dependencies = Object.freeze(["V154P","_portalAutoRechazar","_v154pAvisoDesfasaje","alert","cargarAlertasRetiro","document","esc","getCanal","mapSolicitudPortal","money","normArr","operador","renderInicio","renderSolicitudesPortalCompleto","renderSolicitudesPortalEnInicio","rpc","setTimeout","solicitudes","toast","verificarSolicitudes","window"]);
  function create(deps){
const api = {};
async function cargarSolicitudesPortal(silencioso=false){
    // SAFE: anti-solapamiento. Si hay una carga en curso, dejamos una sola cola.
    if(deps.V154P.solicitudesLoading){
      deps.V154P.solicitudesQueued = true;
      return {ok:true, skipped:true, reason:"solicitudes_loading"};
    }
    deps.V154P.solicitudesLoading = true;
    try{
      const canal = await deps.getCanal();
      const r = await deps.rpc("panel_v15_5_listar_solicitudes_portal", {p_pc_codigo: canal});

      if(r?.error){
        const msg = r.error.message || JSON.stringify(r.error);
        const box = deps.document.getElementById("tablaSolicitudesInicio");
        if(box && !deps.V154P.solicitudesLastHtml){
          box.innerHTML = `<div class="alert-box">Error solicitudes Portal: ${deps.esc(msg)}</div>`;
        }
        // Si ya había una lista pintada, se deja en pantalla para no vaciar la bandeja —
        // pero AVISANDO que está vieja. Sin esto los datos viejos se ven igual que los
        // frescos, y se puede aprobar dos veces algo que ya se resolvió.
        deps.V154P.solicitudesErrorAt = Date.now();
        try{ deps._v154pAvisoDesfasaje(msg); }catch(_e){}
        if(!silencioso) console.error("[V15.4 PLUS] solicitudes portal", r.error);
        return r;
      }
      deps.V154P.solicitudesOkAt = Date.now();
      deps.V154P.solicitudesErrorAt = null;
      try{ deps._v154pAvisoDesfasaje(null); }catch(_e){}

      const _nuevas = deps.normArr(r.data).map(deps.mapSolicitudPortal);
      // Un retiro a medio pagar NO puede desaparecer de la lista. La RPC filtra por estado, así que
      // al pasar el parcial a EN_PROCESO deja de devolverlo y el retiro se esfumaba del panel con
      // plata todavía debida — no había forma de terminar de pagarlo. Los que tienen progreso
      // parcial y ya no vienen del server se conservan del ciclo anterior, marcados, hasta que se
      // salden o los cierre alguien a mano.
      try{
        const _ids = new Set(_nuevas.map(function(x){ return String(x.ID||x.SOLICITUD_ID||''); }));
        (deps.V154P.solicitudes||[]).forEach(function(v){
          const id = String(v.ID||v.SOLICITUD_ID||'');
          if(!id || _ids.has(id)) return;
          const pp = deps.window._retiroParcialInfo ? deps.window._retiroParcialInfo(v) : null;
          if(pp && pp.hasProg && pp.restante > 0.5){
            v.__soloLocal = true;                       // ya no viene del server, lo sostenemos acá
            _nuevas.push(v);
            console.warn('[portal] retiro #'+id+' con '+deps.money(pp.restante)+' sin pagar dejó de venir de la RPC — se conserva local');
          }
        });
      }catch(_e){}
      deps.V154P.solicitudes = _nuevas;
      try{ deps._portalAutoRechazar(deps.V154P.solicitudes); }catch(_e){}
      deps.window.solicitudes = deps.V154P.solicitudes.slice();
      try{ deps.solicitudes = deps.V154P.solicitudes.slice(); }catch(_e){}
      // Cosecha pasiva → base LOCAL de jugadores (portado de NexoBetaChan): cada solicitud del portal
      // trae usuario + teléfono y (según tipo) titular/CBU. Se registra UNA vez por solicitud (Set de
      // sesión) → TODO usuario que operó en el portal queda guardado, aunque nadie lo vincule a mano.
      try{
        if(deps.window.jugadorRegistrarDato && Array.isArray(deps.V154P.solicitudes)){
          deps.window.__jugHarvested = deps.window.__jugHarvested || new Set();
          deps.V154P.solicitudes.forEach(function(s){
            const sid = String(s.ID||s.SOLICITUD_ID||''); if(!sid || deps.window.__jugHarvested.has(sid)) return;
            // Una consulta de SOPORTE —y sobre todo un alta nueva ("soy nuevo, apodo X, tel Y")— es lo
            // que el cliente DECLARA, no un dato del sistema. Guardarla como jugador hacía que el cotejo
            // comparara la declaración contra sí misma y dijera "COINCIDEN · en sistema · mismo dueño"
            // para alguien sin cuenta (Juan, 12/09).
            if(String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='SOPORTE') return;
            const u = String(s.USUARIO||s.USUARIO_JUGADOR||'').trim(); if(!u) return;
            deps.window.__jugHarvested.add(sid);
            let meta = s.METADATA!==undefined?s.METADATA:(s.metadata||{});
            if(typeof meta==='string'){ try{ meta=JSON.parse(meta); }catch(_e){ meta={}; } }
            const esRet = String(s.TIPO||s.TIPO_SOLICITUD||'').toUpperCase()==='RETIRO';
            const dato = {
              telefono: s.TELEFONO || s.telefono || (meta&&meta.telefono) || '',
              titular: s.TITULAR || s.NOMBRE_COMPLETO || (meta&&meta.titular) || '',
              // CBU/alias SOLO de retiros: en una carga ese campo es NUESTRA billetera.
              cbu: esRet ? String(s.CBU||s.CVU||s.CBU_ALIAS||s.DESTINO||(meta&&(meta.cbu||meta.destino))||'').trim() : '',
              fecha: s.FECHA_CREACION || s.FECHA || undefined
            };
            if(dato.telefono || dato.titular || dato.cbu) deps.window.jugadorRegistrarDato(u, dato);
          });
        }
      }catch(_e){}
      // Actualizamos stats generales, pero la caja de inicio queda en manos del render portal.
      try{ if(typeof deps.renderInicio === "function") deps.renderInicio(); }catch(e){}
      deps.renderSolicitudesPortalEnInicio();
      // Alertas de retiro (bono sin liberar / CBU compartido): async y cacheadas 60 s.
      // Cuando llegan, vuelven a pintar la lista solas.
      try{ deps.cargarAlertasRetiro(); }catch(_e){}
      deps.renderSolicitudesPortalCompleto();
      try{ if(typeof deps.verificarSolicitudes === "function") deps.verificarSolicitudes(silencioso); }catch(e){}

      // Auto-refrescar conversación abierta cuando llegan nuevas solicitudes SOPORTE
      try{
        if(deps.window.__nodoChatCurrentTicket && typeof deps.window.renderChatMensajes === "function"){
          const usr = String(deps.window.__nodoChatCurrentTicket.usuario||"").toUpperCase();
          if(typeof deps.window.ticketsAgrupados === "function"){
            const actualizado = deps.window.ticketsAgrupados().find(t=>String(t.usuario||"").toUpperCase()===usr);
            if(actualizado) deps.window.__nodoChatCurrentTicket = actualizado;
          }
          deps.window.renderChatMensajes();
        }
      }catch(_e){}
      return r;
    }finally{
      deps.V154P.solicitudesLoading = false;
      if(deps.V154P.solicitudesQueued){
        deps.V154P.solicitudesQueued = false;
        deps.setTimeout(()=>cargarSolicitudesPortal(true), 350);
      }
    }
  }
  async function actualizarSolicitudPortal(id, estado, extra){
    const payload = {
      p_id: Number(id),
      p_estado: estado,
      p_operador: deps.window.operador?.usuario || deps.window.operador?.nombre
               || (typeof deps.operador!=='undefined' ? (deps.operador?.usuario||deps.operador?.nombre||'') : '')
               || "",
      p_monto: null,
      p_metadata: extra || {}
    };

    // Reintento ante fallos de RED ("fetch failed"/timeout/socket) — típico en la mirror con proxy
    // que pestañea. Setear el estado es IDEMPOTENTE, así que reintentar es seguro (no duplica nada).
    let r, ultimoErr;
    for(let intento = 1; intento <= 3; intento++){
      r = await deps.rpc("panel_v15_5_actualizar_solicitud_portal", payload);
      if(!r?.error){ await cargarSolicitudesPortal(true); return r; }
      ultimoErr = r.error;
      const msg = String(r.error.message || r.error || '').toLowerCase();
      const esRed = /fetch failed|failed to fetch|network|timeout|econn|socket|load failed|networkerror/.test(msg);
      if(!esRed) break; // error real de negocio → no reintentar
      if(intento < 3){
        try{ deps.toast('Red inestable, reintentando actualización ('+intento+'/3)…','yellow'); }catch(_e){}
        await new Promise(res => deps.setTimeout(res, 600 * intento));
      }
    }

    deps.alert("Error actualizando solicitud: " + (ultimoErr?.message || JSON.stringify(ultimoErr)));
    return r;
  }


    return { globals: api, cargarSolicitudesPortal, actualizarSolicitudPortal };
  }
  return Object.freeze({ create, dependencies });
});
