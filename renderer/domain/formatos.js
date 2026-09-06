// Funciones sin DOM ni estado del panel. Los Intl se crean una sola vez, al usarlos.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).formatos=factory();
})(globalThis, function(){
  'use strict';
  const ZONA_AR='America/Argentina/Buenos_Aires';
  let moneda, fechaHora, horaChat, diaArgentina, miles;

  function money(v){
    moneda ||= new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
    return moneda.format(Number(v||0));
  }
  function normalizar(v){ return String(v||'').trim().toUpperCase(); }
  function formatFecha(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return String(fechaRaw||'');
      fechaHora ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false
      });
      return fechaHora.format(fecha).replace(',', ' ·');
    }catch(_e){ return String(fechaRaw||''); }
  }
  function formatearHoraChat(fechaRaw){
    if(!fechaRaw) return '';
    try{
      const fecha=new Date(fechaRaw);
      if(isNaN(fecha)) return '';
      horaChat ||= new Intl.DateTimeFormat('es-AR',{
        timeZone:ZONA_AR, hour:'2-digit', minute:'2-digit', hour12:false
      });
      return horaChat.format(fecha);
    }catch(_e){ return ''; }
  }
  // `ahora` explícito permite verificar límites sin cambiar el reloj del sistema.
  function inicioDiaArgentina(ahora=Date.now()){
    diaArgentina ||= new Intl.DateTimeFormat('en-CA',{
      timeZone:ZONA_AR, year:'numeric', month:'2-digit', day:'2-digit'
    });
    const partes=diaArgentina.formatToParts(new Date(ahora));
    const get=tipo=>partes.find(p=>p.type===tipo).value;
    return new Date(get('year')+'-'+get('month')+'-'+get('day')+'T00:00:00-03:00');
  }
  // Exportación de agentes: MM/DD/YYYY HH:MM:SS interpretado en Argentina.
  function parseFechaCSV(str){
    if(!str) return null;
    const s=String(str).trim();
    const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if(m){
      const iso=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')+'T'
        +(m[4]||'00').padStart(2,'0')+':'+(m[5]||'00').padStart(2,'0')+':'+(m[6]||'00').padStart(2,'0')+'-03:00';
      const fecha=new Date(iso);
      if(!isNaN(fecha)) return fecha;
    }
    const fecha=new Date(s);
    return isNaN(fecha)?null:fecha;
  }
  function getTurno(fechaISO){
    if(!fechaISO) return 'TN';
    const h=new Date(new Date(fechaISO).getTime()-3*60*60*1000).getUTCHours();
    return h>=6&&h<14?'TM':h>=14&&h<22?'TT':'TN';
  }
  function soloDigitos(v){ return Math.abs(Number(String(v==null?'':v).replace(/[^\d]/g,''))||0); }
  function formatMiles(n){
    miles ||= new Intl.NumberFormat('es-AR');
    return miles.format(n);
  }
  function cotejoFmtMiles(v){ const n=soloDigitos(v); return n?formatMiles(n):''; }
  function fmtMilesConSigno(v){
    const neg=/^\s*-/.test(String(v==null?'':v)), n=soloDigitos(v);
    return n?(neg?'-':'')+formatMiles(n):(neg?'-':'');
  }
  function parseMontoConSigno(v){ return /^\s*-/.test(String(v==null?'':v))?-soloDigitos(v):soloDigitos(v); }

  return Object.freeze({money, normalizar, formatFecha, formatearHoraChat, inicioDiaArgentina,
    parseFechaCSV, getTurno, cotejoFmtMiles, fmtMilesConSigno, parseMontoConSigno});
});
