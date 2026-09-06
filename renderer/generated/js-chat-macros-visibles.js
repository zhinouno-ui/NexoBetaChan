
/* ============================================================
   NODO · CHAT MACROS VISIBLES FIX SAFE
   Corrige que en modo chat abierto/full se ocultaba el botón 📋.
   No toca datos, historial, billeteras, motor ni Supabase.
   ============================================================ */
(function(){
  function ensureVisibleMacroButton(){
    const compose = document.querySelector("#viewChat .chat-compose");
    const row = document.querySelector("#viewChat .chat-row");
    if(!compose || !row) return;

    let btn = document.getElementById("nodoMacroBtnVisible");
    if(!btn){
      btn = document.createElement("button");
      btn.id = "nodoMacroBtnVisible";
      btn.type = "button";
      btn.className = "mini-btn gray";
      btn.innerHTML = "📋 Respuestas rápidas";
      btn.title = "Respuestas rápidas";
      btn.onclick = function(ev){
        if(ev) ev.preventDefault();
        if(typeof toggleMacrosPanel === "function") toggleMacrosPanel(ev);
      };

      const bar = document.createElement("div");
      bar.id = "nodoMacroVisibleBar";
      bar.appendChild(btn);
      compose.insertBefore(bar, compose.firstChild);
    }
  }

  function installCss(){
    if(document.getElementById("nodoMacrosVisibleCss")) return;
    const st = document.createElement("style");
    st.id = "nodoMacrosVisibleCss";
    st.textContent = `
      #nodoMacroVisibleBar{
        display:flex!important;
        gap:8px;
        align-items:center;
        justify-content:flex-start;
        margin-bottom:8px;
      }
      #nodoMacroBtnVisible{
        display:inline-flex!important;
        width:auto!important;
        min-width:0!important;
        align-items:center;
        justify-content:center;
        padding:8px 11px!important;
        border-radius:11px!important;
        font-size:12px!important;
        background:#334155!important;
        color:#fff!important;
      }

      /* Rehabilita macros aun cuando el full chat ocultaba botones del composer */
      body.nodo-chat-open #nodoMacroVisibleBar,
      body.chat-expanded #nodoMacroVisibleBar{
        display:flex!important;
      }

      body.nodo-chat-open #macrosPanel,
      body.chat-expanded #macrosPanel{
        display:grid;
        left:10px!important;
        right:10px!important;
        bottom:calc(100% + 8px)!important;
        max-height:360px!important;
        overflow:auto!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        z-index:9999!important;
      }

      body.nodo-chat-open #macrosPanel.hidden,
      body.chat-expanded #macrosPanel.hidden{
        display:none!important;
      }

      @media(max-width:900px){
        body.nodo-chat-open #macrosPanel,
        body.chat-expanded #macrosPanel{
          grid-template-columns:1fr!important;
        }
      }
    `;
    document.head.appendChild(st);
  }

  const oldToggle = window.toggleMacrosPanel;
  window.toggleMacrosPanel = function(ev){
    installCss();
    ensureVisibleMacroButton();
    if(typeof oldToggle === "function"){
      oldToggle(ev);
    }else{
      const panel = document.getElementById("macrosPanel");
      if(panel) panel.classList.toggle("hidden");
    }
  };

  setTimeout(function(){
    installCss();
    ensureVisibleMacroButton();
  },700);

  setInterval(function(){
    try{
      installCss();
      ensureVisibleMacroButton();
    }catch(_e){}
  },2500);
})();
