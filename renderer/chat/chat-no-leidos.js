
/* ============================================================
   NODO · CHAT STEP 6 UNREAD BADGES SAFE
   Agrega notificaciones de nuevos mensajes:
   - Badge lateral Chat
   - Contador en Inicio
   - Badge en pestaña Abiertos
   - "nuevo" en fila del chat abierto
   No toca historial, billeteras, cargas/retiros ni worker.
   ============================================================ */
(function(){
  function S(v){return String(v??"")}
  function U(v){return S(v).trim().toUpperCase()}
  function toDate(v){const d=new Date(v||0);return isNaN(d.getTime())?new Date(0):d}
  function nowIso(){return new Date().toISOString()}
  function readKey(){return "nodo_chat_read_marks_v1"}
  function notifyKey(){return "nodo_chat_notified_keys_v1"}
  function getJson(key,def){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(def))}catch(_e){return def}}
  function setJson(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(_e){}}
  function chatKey(t){
    const id = t?.masterId || t?.solicitudId || t?.usuario || "chat";
    return U(t?.usuario||"usuario")+"_"+String(id).replace(/[^A-Z0-9]/gi,"_");
  }
  function userMsgs(t){
    return (t?.thread||[]).filter(m=>U(m.origen)==="USUARIO").sort((a,b)=>toDate(a.fecha)-toDate(b.fecha));
  }
  function lastUserMsgTime(t){
    const msgs=userMsgs(t);
    return msgs.length ? (msgs[msgs.length-1].fecha||"") : "";
  }
  function unreadForTicket(t){
    if(!t || !t.accepted) return 0;
    const marks=getJson(readKey(),{});
    const readAt=marks[chatKey(t)]||"";
    const rd=toDate(readAt);
    return userMsgs(t).filter(m=>toDate(m.fecha)>rd).length;
  }
  function allTickets(){
    try{
      if(typeof window.ticketsAgrupados==="function") return window.ticketsAgrupados()||[];
    }catch(_e){}
    return [];
  }
  function unreadTotal(){
    return allTickets().filter(t=>t.accepted).reduce((a,t)=>a+unreadForTicket(t),0);
  }
  function markRead(t){
    if(!t) return;
    const last=lastUserMsgTime(t) || nowIso();
    const marks=getJson(readKey(),{});
    marks[chatKey(t)] = last;
    setJson(readKey(),marks);
    updateChatUnreadBadges();
  }
  window.nodoChatMarkReadCurrent=function(){
    const t=window.__nodoChatCurrentTicket;
    if(t) markRead(t);
  };
  // Marcar TODAS las conversaciones como leídas (local, mismo mecanismo que markRead por ticket).
  window.nodoChatMarkAllRead=function(){
    try{
      const tickets=allTickets().filter(t=>t.accepted);
      const marks=getJson(readKey(),{});
      tickets.forEach(t=>{ marks[chatKey(t)] = lastUserMsgTime(t) || nowIso(); });
      setJson(readKey(),marks);
      updateChatUnreadBadges();
      if(typeof renderChatListStep2Final==="function") renderChatListStep2Final();
      try{ if(typeof toast==="function") toast("✓ Todas marcadas como leídas","green"); }catch(_e){}
    }catch(_e){ console.warn("markAllRead",_e); }
  };

  function notifyNewMessages(){
    const tickets=allTickets().filter(t=>t.accepted);
    const notified=getJson(notifyKey(),{});
    let changed=false;

    tickets.forEach(t=>{
      const msgs=userMsgs(t);
      msgs.forEach(m=>{
        const k=[chatKey(t),m.solicitud_id||"",m.fecha||"",m.mensaje||""].join("|");
        if(notified[k]) return;

        const unread=unreadForTicket(t);
        const isCurrent = document.body.classList.contains("nodo-chat-open") && U(window.__nodoChatCurrentUser||"")===U(t.usuario);
        // Si no estoy mirando ese chat y hay no leídos, aviso una sola vez.
        if(unread>0 && !isCurrent){
          try{ if(typeof toast==="function") toast("💬 Nuevo mensaje de "+(t.usuario||"usuario"),"blue"); }catch(_e){}
          notified[k]=true; changed=true;
        }
      });
    });
    if(changed) setJson(notifyKey(),notified);
  }

  function updateChatUnreadBadges(){
    const total=unreadTotal();

    // Badge lateral Chat
    const badge=document.getElementById("badgeChat");
    if(badge){
      if(total>0){badge.classList.remove("hidden");badge.textContent=String(total)}
      else{badge.classList.add("hidden");badge.textContent="0"}
    }

    // Stat Inicio
    const stat=document.getElementById("statChats");
    if(stat) stat.textContent=String(total);

    const sub=stat?.parentElement?.querySelector(".stat-sub");
    if(sub) sub.textContent = total>0 ? "Mensajes nuevos portal" : "Consultas portal";

    // Botón nav chat highlight
    const nav=document.getElementById("navChat");
    if(nav){
      nav.style.boxShadow = total>0 ? "0 0 0 1px rgba(18,183,106,.65),0 0 18px rgba(18,183,106,.25)" : "";
    }

    // Tabs y filas visuales
    const list=document.getElementById("chatList")||document.getElementById("v15ChatList");
    if(list){
      const tabs=list.querySelectorAll(".wq2-tab");
      if(tabs && tabs.length>=2){
        const abiertos=allTickets().filter(t=>t.accepted).length;
        tabs[1].innerHTML = `Abiertos ${abiertos?`<span class="wq2-count">${abiertos}</span>`:""}${total?` <span class="wq2-count" style="background:#ef4444">${total}</span>`:""}`;
      }

      list.querySelectorAll(".wq2-item").forEach(item=>{
        const name=item.querySelector(".wq2-name")?.textContent?.trim();
        const t=allTickets().find(x=>U(x.usuario)===U(name));
        if(!t) return;
        const u=unreadForTicket(t);
        let marker=item.querySelector(".wq2-unread-final");
        if(u>0){
          if(!marker){
            marker=document.createElement("span");
            marker.className="wq2-unread-final";
            const meta=item.querySelector(".wq2-meta") || item;
            meta.appendChild(marker);
          }
          marker.textContent=String(u);
          const state=item.querySelector(".wq2-state");
          if(state && !state.textContent.includes("nuevo")){
            state.textContent += ` · ${u} nuevo${u>1?"s":""}`;
          }
        }else if(marker){marker.remove();}
      });
    }
  }

  function ensureCss(){
    if(document.getElementById("chatStep6UnreadCss"))return;
    const st=document.createElement("style");
    st.id="chatStep6UnreadCss";
    st.textContent=`
      .wq2-unread-final{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-width:20px;
        height:20px;
        border-radius:999px;
        background:#ef4444;
        color:#fff;
        font-size:11px;
        font-weight:950;
        margin-left:6px;
        box-shadow:0 0 0 2px rgba(239,68,68,.15);
      }
      .wq2-item:has(.wq2-unread-final){
        box-shadow:inset 0 0 0 1px rgba(239,68,68,.22);
      }
    `;
    document.head.appendChild(st);
  }

  // Wrap render lista para agregar badges después del render.
  const oldRenderList=window.renderChatListStep2;
  if(typeof oldRenderList==="function"){
    window.renderChatListStep2=function(){
      const r=oldRenderList.apply(this,arguments);
      setTimeout(()=>{ensureCss();updateChatUnreadBadges();},40);
      return r;
    };
  }

  // Wrap abrir/aceptar: si estoy abriendo el chat, queda leído.
  const oldAccept=window.aceptarTicketLocalStep2;
  if(typeof oldAccept==="function"){
    window.aceptarTicketLocalStep2=function(ticketId){
      const r=oldAccept.apply(this,arguments);
      setTimeout(()=>{
        const t=window.__nodoChatCurrentTicket;
        if(t) markRead(t);
        updateChatUnreadBadges();
      },450);
      return r;
    };
  }

  // Wrap conversación: si estoy dentro del chat, marco leído.
  const oldRenderMsg=window.renderChatMensajes;
  if(typeof oldRenderMsg==="function"){
    window.renderChatMensajes=function(){
      const r=oldRenderMsg.apply(this,arguments);
      setTimeout(()=>{
        if(document.body.classList.contains("nodo-chat-open")){
          const t=window.__nodoChatCurrentTicket;
          if(t) markRead(t);
        }
      },120);
      return r;
    };
  }

  // Al volver a bandeja NO marca leído; solo muestra contador.
  document.addEventListener("keydown",function(ev){
    if(ev.key==="Escape") setTimeout(updateChatUnreadBadges,250);
  },true);

  ensureCss();
  setInterval(function(){
    try{
      notifyNewMessages();
      updateChatUnreadBadges();
    }catch(_e){}
  },1800);

  setTimeout(function(){
    try{updateChatUnreadBadges()}catch(_e){}
  },900);
})();
