
/* ============================================================
   NODO · BASE PILOTO OPERATIVO · JS FINAL
   Limpieza/consolidación visual sin tocar motor.
   ============================================================ */
(function(){
  const VERSION="BASE_PILOTO_OPERATIVO_2026_06";
  function badgePiloto(){
    if(document.getElementById("nodoPilotoBadge"))return;
    const b=document.createElement("div");
    b.id="nodoPilotoBadge";
    b.textContent="NODO · PILOTO OPERATIVO";
    document.body.appendChild(b);
  }
  function fixLabels(){
    try{
      document.querySelectorAll("*").forEach(el=>{
        if(el.childNodes && el.childNodes.length===1 && el.childNodes[0].nodeType===3){
          const t=el.textContent;
          const nt=t
            .replace(/Consultas landing/g,"Consultas portal")
            .replace(/Billetera en landing/g,"Billetera en portal")
            .replace(/EN LANDING/g,"EN PORTAL");
          if(nt!==t)el.textContent=nt;
        }
      });
    }catch(_e){}
  }
  function safePanelHealth(){
    const checks={
      version:VERSION,
      timestamp:new Date().toISOString(),
      hasSupabase:!!window.supabaseClient,
      hasOperador:!!window.operador,
      hasManualMotor:typeof window.ejecutarOperacionManual==="function" || typeof window.ejecutarOperacion==="function",
      hasHistorialRender:typeof window.renderHistorial==="function",
      hasPortalUpdate:typeof window.actualizarSolicitudPortal==="function",
      hasChatRender:typeof window.renderChatListStep2==="function" || typeof window.cargarChats==="function",
      hasCRM:typeof window.cargarJugadores==="function",
      hasMacros:typeof window.toggleMacrosPanel==="function" || typeof window.nodoMacroRapida==="function"
    };
    window.NODO_PILOTO_HEALTH=checks;
    return checks;
  }
  function exposeDiagnostics(){
    window.nodoDiagnosticoPiloto=function(){
      const h=safePanelHealth();
      console.table(h);
      try{if(typeof toast==="function")toast("Diagnóstico piloto enviado a consola","green")}catch(_e){}
      return h;
    };
    window.nodoChecklistPiloto=function(){
      const h=safePanelHealth();
      const ok=[
        ["Historial",h.hasHistorialRender],
        ["Solicitudes portal",h.hasPortalUpdate],
        ["Chat",h.hasChatRender],
        ["Macros",h.hasMacros],
        ["CRM",h.hasCRM]
      ];
      console.table(ok.map(x=>({modulo:x[0],ok:x[1]})));
      return ok;
    };
  }
  function stabilizeChatBadges(){
    try{
      const stat=document.getElementById("statChats");
      const sub=stat?.parentElement?.querySelector(".stat-sub");
      if(sub && /landing/i.test(sub.textContent))sub.textContent="Consultas portal";
    }catch(_e){}
  }
  function installMacroButtonIfMissing(){
    try{
      if(typeof window.toggleMacrosPanel!=="function")return;
      const compose=document.querySelector("#viewChat .chat-compose");
      if(!compose)return;
      if(document.getElementById("nodoMacroVisibleBar"))return;
      const bar=document.createElement("div");
      bar.id="nodoMacroVisibleBar";
      const btn=document.createElement("button");
      btn.id="nodoMacroBtnVisible";
      btn.type="button";
      btn.className="mini-btn gray";
      btn.textContent="📋 Respuestas rápidas";
      btn.onclick=(ev)=>window.toggleMacrosPanel(ev);
      bar.appendChild(btn);
      compose.insertBefore(bar,compose.firstChild);
    }catch(_e){}
  }
  function initPiloto(){
    badgePiloto();
    fixLabels();
    exposeDiagnostics();
    safePanelHealth();
    stabilizeChatBadges();
    installMacroButtonIfMissing();
  }
  setTimeout(initPiloto,700);
  setInterval(function(){
    fixLabels();
    stabilizeChatBadges();
    installMacroButtonIfMissing();
  },3000);
})();
