// Motor puro: recibe casos/historial; no consulta DOM, red, billeteras ni almacenamiento.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory();
  else (root.NodoDomain||(root.NodoDomain={})).conciliacion=factory();
})(globalThis, function(){
  'use strict';
  const HORA=60*60*1000, OFFSET_AR=-3*HORA;
  function turno(ts=Date.now()){
    // Trabajar en UTC sobre la hora desplazada evita depender del TZ de Windows.
    const d=new Date(new Date(ts).getTime()+OFFSET_AR), h=d.getUTCHours();
    let franja, inicio;
    if(h>=22){ franja='22-06'; inicio=22; }
    else if(h<6){ franja='22-06'; inicio=22; d.setUTCDate(d.getUTCDate()-1); }
    else if(h<14){ franja='06-14'; inicio=6; }
    else{ franja='14-22'; inicio=14; }
    const id=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0')+'_'+franja;
    d.setUTCHours(inicio,0,0,0);
    return {id, inicioMs:d.getTime()-OFFSET_AR};
  }
  function turnoId(ts){ return turno(ts).id; }
  function inicioTurnoMs(ts){ return turno(ts).inicioMs; }
  function agregar(map, key, value){
    const values=map.get(key);
    if(values) values.push(value); else map.set(key,[value]);
  }
  function match(casos, movs){
    casos=Array.isArray(casos)?casos:[]; movs=Array.isArray(movs)?movs:[];
    const falt=[], sobr=[], sobrPorMonto=new Map(), retiros=new Map(), deposPorMonto=new Map();
    for(const c of casos){
      const monto=Number(c.monto_disponible);
      if(!(monto>0)) continue;
      if(c.tipo==='FALTANTE') falt.push(c);
      if(c.tipo==='SOBRANTE'){ sobr.push(c); agregar(sobrPorMonto,monto,c); }
    }
    // Una sola pasada sobre movimientos, en vez de filtrarlos por cada caso.
    for(const mov of movs){
      const tipo=String(mov.tipo||'').toUpperCase(), monto=Math.abs(Number(mov.monto));
      if(tipo==='RETIRO'&&!mov.esTransferenciaInterna){
        const wallet=String(mov.billetera_id);
        if(!retiros.has(wallet)) retiros.set(wallet,new Map());
        agregar(retiros.get(wallet),monto,mov);
      }else if(tipo==='DEPOSITO_SR'&&!(mov.usuario&&String(mov.usuario).trim())) agregar(deposPorMonto,monto,mov);
    }
    const sugerencias=[], combinaciones=[], explicaciones=[], usadosSobr=new Set();
    for(const f of falt){
      const monto=Number(f.monto_disponible);
      const pares=(sobrPorMonto.get(monto)||[]).filter(s=>!usadosSobr.has(s.case_id)&&s.wallet_id!==f.wallet_id);
      if(pares.length){
        const s=pares[0];
        if(pares.length===1) usadosSobr.add(s.case_id);
        const candidatos=(retiros.get(String(s.wallet_id))?.get(monto)||[]).slice();
        sugerencias.push({tipo:'MOVER_RETIRO', confianza:pares.length===1&&candidatos.length===1?'EXACTA':'AMBIGUA',
          caso_faltante:f.case_id, caso_sobrante:s.case_id, pares_posibles:pares.map(p=>p.case_id), candidatos});
        continue;
      }
      // Se mantiene orden y aritmética original: combinaciones sólo sugeridas, nunca aplicadas.
      for(let i=0;i<sobr.length;i++) for(let j=i+1;j<sobr.length;j++){
        if(Number(sobr[i].monto_disponible)+Number(sobr[j].monto_disponible)===monto)
          combinaciones.push({tipo:'COMBINACION',caso:f.case_id,partes:[sobr[i].case_id,sobr[j].case_id]});
      }
    }
    for(const s of sobr){
      if(usadosSobr.has(s.case_id)) continue;
      const candidatos=deposPorMonto.get(Number(s.monto_disponible));
      if(candidatos?.length) explicaciones.push({tipo:'DEPO_EXISTENTE',caso:s.case_id,candidatos:candidatos.slice()});
    }
    return {sugerencias, combinaciones, explicaciones};
  }
  function movimientosTurno(historial, inicioMs, estados=['OK','ACREDITADA','PAGADA','COMPLETADA','APROBADA']){
    const permitidos=new Set(estados), movimientos=[];
    for(const h of historial){
      const ts=h.created_at?new Date(h.created_at).getTime():0;
      if(!(ts>=inicioMs)||!permitidos.has(String(h.estado||'').toUpperCase())) continue;
      movimientos.push({id:h.id,tipo:String(h.tipo||'').toUpperCase(),billetera_id:String(h.billetera_id||''),
        billetera_nombre:h.billetera_nombre||'',monto:Math.abs(Number(h.monto||0)),usuario:h.usuario||'',
        esTransferenciaInterna:/transfer/i.test(String(h.origen||'')+' '+String(h.notas||'')),
        chunior_movimiento_id:h.chunior_movimiento_id||null,ts,_fila:h});
    }
    return movimientos;
  }
  function indexarMovimientos(movimientos){
    const porBilletera=new Map();
    for(const mov of movimientos) agregar(porBilletera,String(mov.billetera_id),mov);
    return porBilletera;
  }
  function declaracion(saldo, valor){
    const decl=Math.abs(Number(String(valor).replace(/[^\d]/g,''))||0);
    const chunior=Number(saldo.saldo_chunior||0), dif=Math.round(decl-chunior);
    const resid=+(decl-chunior-dif).toFixed(2);
    return {wallet_id:saldo.wallet_id,nombre:saldo.nombre,chunior,decl,dif,resid};
  }
  return Object.freeze({turnoId, inicioTurnoMs, match, movimientosTurno, indexarMovimientos, declaracion});
});
