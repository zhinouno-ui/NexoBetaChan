
/* ============================================================
   NODO · CHAT STEP 7 NO FLICKER SAFE
   Estabiliza visualmente badges/lista:
   - evita parpadeo de contador 1 -> 0 -> 1
   - no repinta bandeja si el contenido no cambió
   - mantiene notificaciones
   No toca datos, historial, billeteras ni motor.
   ============================================================ */
(function(){
  const metrics = NodoChatMetrics.create({
    getTickets: () => { try { return window.ticketsAgrupados?.() || []; } catch(_) { return []; } },
    readMarks: () => { try { return JSON.parse(localStorage.getItem('nodo_chat_read_marks_v1') || '{}'); } catch(_) { return {}; } }
  });
  let lastListSignature = '';
  let lastRenderAt = 0;
  function signatureTickets(){ return metrics.read().signature; }

  function updateStableBadges(){
    const snapshot = metrics.read();
    const total = metrics.stableTotal(snapshot.total);

    const badge=document.getElementById("badgeChat");
    if(badge){
      if(total>0){
        badge.classList.remove("hidden");
        badge.textContent=String(total);
      }else{
        badge.classList.add("hidden");
        badge.textContent="0";
      }
    }

    const stat=document.getElementById("statChats");
    if(stat){
      const current = String(stat.textContent || "");
      const next = String(total);
      if(current !== next) stat.textContent = next;
    }

    const sub=stat?.parentElement?.querySelector(".stat-sub");
    if(sub){
      const txt = total>0 ? "Mensajes nuevos portal" : "Consultas portal";
      if(sub.textContent !== txt) sub.textContent = txt;
    }

    const nav=document.getElementById("navChat");
    if(nav){
      nav.style.boxShadow = total>0 ? "0 0 0 1px rgba(18,183,106,.65),0 0 18px rgba(18,183,106,.25)" : "";
    }

    const list=document.getElementById("chatList")||document.getElementById("v15ChatList");
    if(list){
      const tabs=list.querySelectorAll(".wq2-tab");
      if(tabs && tabs.length>=2){
        const abiertos=snapshot.accepted;
        const newHtml = `Abiertos ${abiertos?`<span class="wq2-count">${abiertos}</span>`:""}${total?` <span class="wq2-count" style="background:#ef4444">${total}</span>`:""}`;
        if(tabs[1].innerHTML !== newHtml) tabs[1].innerHTML = newHtml;
      }

      list.querySelectorAll(".wq2-item").forEach(item=>{
        const name=item.querySelector(".wq2-name")?.textContent?.trim();
        const t=snapshot.byUser.get(String(name ?? "").trim().toUpperCase());
        if(!t) return;
        const u=snapshot.unread.get(t) || 0;
        let marker=item.querySelector(".wq2-unread-final");
        const meta=item.querySelector(".wq2-meta") || item;
        if(u>0){
          if(!marker){
            marker=document.createElement("span");
            marker.className="wq2-unread-final";
            meta.appendChild(marker);
          }
          if(marker.textContent !== String(u)) marker.textContent=String(u);
          const state=item.querySelector(".wq2-state");
          if(state && !state.textContent.includes("nuevo")){
            state.textContent += ` · ${u} nuevo${u>1?"s":""}`;
          }
        }else if(marker){
          marker.remove();
        }
      });
    }
  }

  // Reemplaza el render completo por render controlado cuando no cambió nada.
  const oldRenderList = window.renderChatListStep2;
  if(typeof oldRenderList === "function"){
    window.renderChatListStep2 = function(){
      const sig = signatureTickets();
      const now = Date.now();
      const list=document.getElementById("chatList")||document.getElementById("v15ChatList");

      // Si la firma no cambió y ya existe la bandeja, no la repinto entera.
      if(list && list.innerHTML && sig === lastListSignature && now - lastRenderAt < 3500){
        updateStableBadges();
        return;
      }

      lastListSignature = sig;
      lastRenderAt = now;
      const r = oldRenderList.apply(this,arguments);
      setTimeout(updateStableBadges,60);
      return r;
    };
  }

  // Baja frecuencia del refresco visual: solo badges.
  setInterval(function(){
    try{updateStableBadges()}catch(_e){}
  },900);

  setTimeout(function(){
    try{lastListSignature=signatureTickets();updateStableBadges()}catch(_e){}
  },800);
})();
