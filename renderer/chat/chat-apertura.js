
/* ============================================================
   NODO · CHAT STEP 4 OPEN FLOW SAFE
   Ajusta UX:
   - Aceptar una vez.
   - Luego queda como Abierto.
   - Botón pasa a "Abrir".
   - No toca Supabase, historial, billeteras ni motor.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function acceptedKey(){return "nodo_chat_accepted_users_v1"}
  function getAccepted(){
    try{return JSON.parse(localStorage.getItem(acceptedKey())||"{}")}catch(_e){return{}}
  }
  function setAccepted(usuario,val){
    const map=getAccepted();
    map[U(usuario)]={accepted:!!val,at:new Date().toISOString()};
    localStorage.setItem(acceptedKey(),JSON.stringify(map));
  }
  function isAccepted(usuario){
    const map=getAccepted();
    return !!map[U(usuario)]?.accepted;
  }

  // Cuando se acepta por primera vez, queda marcado como chat abierto.
  const oldAccept = window.aceptarTicketLocalStep2;
  if(typeof oldAccept === "function"){
    window.aceptarTicketLocalStep2 = function(ticketId){
      oldAccept(ticketId);
      setTimeout(function(){
        const ticket = window.__nodoChatCurrentTicket;
        if(ticket && ticket.usuario) setAccepted(ticket.usuario,true);
        try{ mejorarBandejaChatAbierto(); }catch(_e){}
      },120);
    };
  }

  function mejorarBandejaChatAbierto(){
    // El render ya maneja el estado correcto (isAcceptedExt en renderChatListStep2).
    // Esta función queda como no-op para compatibilidad con llamadas existentes.
  }

  // Expone isAccepted globalmente para que BLQ8 pueda usarlo en render
  window._wq2IsAccepted = isAccepted;

  // Envuelve render: aplica estado aceptado de forma SÍNCRONA (sin flash)
  const oldRenderList = window.renderChatListStep2;
  if(typeof oldRenderList === "function"){
    window.renderChatListStep2 = function(){
      oldRenderList();
      mejorarBandejaChatAbierto(); // síncrono: sin setTimeout, sin flash
    };
  }

  // Cuando vuelve con Esc/Bandeja, se mantiene como abierto.
  document.addEventListener("keydown",function(ev){
    if(ev.key==="Escape"){
      setTimeout(mejorarBandejaChatAbierto,80);
    }
  },true);

  // CSS específico.
  if(!document.getElementById("chatStep4OpenCss")){
    const st=document.createElement("style");
    st.id="chatStep4OpenCss";
    st.textContent=`
      .chat-abierto-local{
        background:#102018!important;
        border-left:3px solid #16a34a!important;
      }
      .chat-abierto-local:hover{
        background:#12301f!important;
      }
    `;
    document.head.appendChild(st);
  }
})();
