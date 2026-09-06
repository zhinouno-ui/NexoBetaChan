
/* ============================================================
   NODO · CHAT STEP 2 UX FULL CHAT
   - Al aceptar/abrir chat, la conversación ocupa todo el módulo.
   - Escape vuelve a la bandeja.
   - No toca Supabase ni historial.
   ============================================================ */
(function(){
  function installFullChatCss(){
    if(document.getElementById("nodoStep2FullChatCss")) return;
    const st=document.createElement("style");
    st.id="nodoStep2FullChatCss";
    st.textContent = `
      body.nodo-chat-open #viewChat .chat-layout{
        grid-template-columns:1fr!important;
      }
      body.nodo-chat-open #viewChat .chat-list{
        display:none!important;
      }
      body.nodo-chat-open #viewChat .chat-panel{
        display:block!important;
        width:100%!important;
        min-height:650px!important;
        background:#0b0f17!important;
      }
      body.nodo-chat-open #viewChat .chat-head{
        display:flex!important;
        align-items:center!important;
        justify-content:space-between!important;
        background:#111827!important;
        border-bottom:1px solid #252b38!important;
      }
      body.nodo-chat-open #chatBody{
        flex:1!important;
        min-height:0!important;
        max-height:calc(100vh - 240px)!important;
        overflow-y:auto!important;
      }
      body.nodo-chat-open #viewChat .chat-input-row,
      body.nodo-chat-open #viewChat .composer,
      body.nodo-chat-open #viewChat .chat-composer{
        background:#0b0f17!important;
        border-top:1px solid #252b38!important;
      }
      body:not(.nodo-chat-open) #viewChat .chat-layout{
        grid-template-columns:1fr!important;
      }
      body:not(.nodo-chat-open) #viewChat .chat-panel{
        display:none!important;
      }
      /* display:block MATABA el scroll de la bandeja: .chat-list es una columna flex y #chatList
         saca su altura de ahí (flex:1 + overflow-y:auto). En block, #chatList crece con el
         contenido, se pasa del alto de la tarjeta y .chat-list (overflow:hidden) lo recorta —
         con 42 cerrados no había forma de bajar. Sigue ocupando todo el ancho, pero como flex. */
      body:not(.nodo-chat-open) #viewChat .chat-list{
        display:flex!important;
        flex-direction:column!important;
        min-height:0!important;
        width:100%!important;
      }
      .nodo-chat-back-hint{
        display:inline-flex;
        align-items:center;
        gap:6px;
        border:0;
        border-radius:10px;
        background:#334155;
        color:#fff;
        font-weight:900;
        padding:8px 11px;
        cursor:pointer;
        font-size:12px;
      }
    `;
    document.head.appendChild(st);
  }

  function backToChatList(){
    document.body.classList.remove("nodo-chat-open");
    window.__nodoChatCurrentUser = "";
    window.__nodoChatCurrentTicket = null;
    try{
      // Preferir SIEMPRE el render activo (Final). Antes llamaba a renderChatListStep2 (módulo
      // viejo), así que al volver a la bandeja la lista de "en espera" se pintaba con el render
      // viejo (otros tabs/datos) → se veía distinto de donde debería.
      if(typeof renderChatListStep2Final === "function") renderChatListStep2Final();
      else if(typeof renderChatListStep2 === "function") renderChatListStep2();
      else if(typeof cargarChats === "function") cargarChats();
    }catch(_e){}
    const body=document.getElementById("chatBody") || document.getElementById("v15ChatBody");
    if(body) body.innerHTML = `<div class="alert-box">Seleccioná una consulta de la bandeja.</div>`;
  }

  function enhanceChatHeader(){
    const head = document.querySelector("#viewChat .chat-head");
    if(!head) return;
    if(head.querySelector(".nodo-chat-back-hint")) return;
    const btn=document.createElement("button");
    btn.className="nodo-chat-back-hint";
    btn.innerHTML="← Bandeja / Esc";
    btn.onclick=backToChatList;
    head.insertBefore(btn, head.firstChild);
  }

  // Envolvemos aceptar para agregar UX full chat sin cambiar la lógica local.
  const oldAccept = window.aceptarTicketLocalStep2;
  if(typeof oldAccept === "function"){
    window.aceptarTicketLocalStep2 = function(ticketId){
      oldAccept(ticketId);
      installFullChatCss();
      document.body.classList.add("nodo-chat-open");
      setTimeout(enhanceChatHeader, 100);
      setTimeout(enhanceChatHeader, 500);
    };
  }

  window.cerrarChatExpandido = backToChatList;
  window.nodoChatBackToList = backToChatList;

  document.addEventListener("keydown", function(ev){
    if(ev.key === "Escape" && document.body.classList.contains("nodo-chat-open")){
      ev.preventDefault();
      backToChatList();
    }
  }, true);

  installFullChatCss();
  setTimeout(enhanceChatHeader, 800);
})();
