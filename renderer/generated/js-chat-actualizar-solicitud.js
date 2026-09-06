
/* ============================================================
   NODO · CHAT STEP 3 USAR actualizarSolicitudPortal SAFE
   Evita REST directo y RPC nuevas.
   Usa la función interna existente actualizarSolicitudPortal(...)
   ============================================================ */
(function(){
  function S(v){ return String(v ?? ""); }
  function U(v){ return S(v).trim().toUpperCase(); }
  function storageKey(id){ return "nodo_chat_local_" + String(id||"x").replace(/[^A-Z0-9]/gi,"_"); }
  function getSavedMsgs(id){ try{ return JSON.parse(localStorage.getItem(storageKey(id)) || "[]"); }catch(_e){ return []; } }
  function idSol(s){ return Number(s.ID || s.SOLICITUD_ID || s.id || 0); }
  function msgSol(s){ return s.MENSAJE_INICIAL || s.mensaje_inicial || s.DESTINO || s.destino || "Consulta desde portal"; }
  function fechaSol(s){ return s.FECHA_CREACION || s.FECHA || s.created_at || s.updated_at || new Date().toISOString(); }
  function ticketActual(){ return window.__nodoChatCurrentTicket || null; }

  function buildThread(ticket){
    const thread = [];
    (ticket.items || []).slice().sort(function(a,b){
      return new Date(fechaSol(a)||0) - new Date(fechaSol(b)||0);
    }).forEach(function(s){
      const sid = idSol(s);
      if(sid){
        thread.push({
          origen:"USUARIO",
          usuario:ticket.usuario,
          mensaje:msgSol(s),
          fecha:fechaSol(s),
          solicitud_id:sid
        });
      }
    });

    const saved = getSavedMsgs(ticket.solicitudId || ticket.usuario);
    saved.forEach(function(m){
      thread.push({
        origen: U(m.tipo)==="OPERADOR" ? "OPERADOR" : "USUARIO",
        usuario: ticket.usuario,
        operador: (window.operador?.usuario || window.operador?.nombre || "panel"),
        mensaje: m.mensaje || "",
        fecha: m.fecha || new Date().toISOString()
      });
    });

    return thread;
  }

  async function persistirPorActualizador(ticket, estadoChat){
    if(typeof actualizarSolicitudPortal !== "function"){
      throw new Error("actualizarSolicitudPortal no está disponible en este panel");
    }

    const thread = buildThread(ticket);
    const operador = (window.operador?.usuario || window.operador?.nombre || "panel");

    for(const s of (ticket.items || [])){
      const sid = idSol(s);
      if(!sid) continue;

      await actualizarSolicitudPortal(sid, "EN_REVISION", {
        chat_estado: estadoChat || "ABIERTO_PANEL",
        chat_operador: operador,
        chat_ultimo_operador: operador,
        chat_ultima_respuesta_at: new Date().toISOString(),
        chat_thread: thread
      });
    }
  }

  const oldAccept = window.aceptarTicketLocalStep2;
  if(typeof oldAccept === "function"){
    window.aceptarTicketLocalStep2 = function(ticketId){
      oldAccept(ticketId);

      setTimeout(async function(){
        const ticket = ticketActual();
        if(!ticket) return;
        try{
          await persistirPorActualizador(ticket, "ABIERTO_PANEL");
          try{ if(typeof toast==="function") toast("Chat vinculado a solicitud", "green"); }catch(_e){}
        }catch(e){
          console.warn("persist accept actualizarSolicitudPortal:", e);
          try{ if(typeof toast==="function") toast("Chat abierto local. Persistencia pendiente.", "orange"); }catch(_e){}
        }
      }, 250);
    };
  }

  const oldEnviar = window.enviarChat;
  window.enviarChat = async function(){
    const ticket = ticketActual();
    const input = document.getElementById("chatInput") || document.getElementById("v15ChatInput");
    const msg = S(input?.value).trim();

    // Mantiene respuesta visual/local original.
    if(typeof oldEnviar === "function"){
      await oldEnviar();
    }

    if(!ticket || !msg) return {ok:true, local:true};

    try{
      await persistirPorActualizador(ticket, "RESPONDIDO_PANEL");
      try{ if(typeof toast==="function") toast("Respuesta guardada para portal", "green"); }catch(_e){}
      return {ok:true};
    }catch(e){
      console.warn("persist send actualizarSolicitudPortal:", e);
      alert("La respuesta quedó local, pero no se pudo guardar por actualizador: " + (e.message || "sin detalle"));
      return {ok:false,error:e};
    }
  };

  window.v15EnviarChatCompacto = window.enviarChat;
})();
