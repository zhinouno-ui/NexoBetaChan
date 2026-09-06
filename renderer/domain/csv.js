// Importación: convierte texto en datos; el adaptador del panel administra archivos y Supabase.
(function(root, factory){
  if(typeof module==='object' && module.exports && typeof window==='undefined') module.exports=factory(require('./formatos.js'));
  else (root.NodoDomain||(root.NodoDomain={})).csv=factory(root.NodoDomain.formatos);
})(globalThis, function(formatos){
  'use strict';
  function parseCSV(text){
    if(text.charCodeAt(0)===0xFEFF) text=text.slice(1);
    const rows=[];
    let row=[], cur='', inQuotes=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(inQuotes){
        if(c==='"'&&text[i+1]==='"'){ cur+='"'; i++; }
        else if(c==='"') inQuotes=false;
        else cur+=c;
      }else{
        if(c==='"') inQuotes=true;
        else if(c===','){ row.push(cur); cur=''; }
        else if(c==='\n'||c==='\r'){
          row.push(cur); rows.push(row); row=[]; cur='';
          if(c==='\r'&&text[i+1]==='\n') i++;
        }else cur+=c;
      }
    }
    if(cur||row.length||text.endsWith('"')){ row.push(cur); rows.push(row); }
    return rows;
  }
  function cleanPhone(v){ return v?(String(v).replace(/[^\d]/g,'')||null):null; }
  function parseNumCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=Number(String(v).replace(/\./g,'').replace(',','.'));
    return Number.isFinite(n)?n:0;
  }
  function parseIntCsv(v){
    if(v===undefined||v===null||v==='') return 0;
    const n=parseInt(String(v).trim(),10);
    return Number.isFinite(n)?n:0;
  }
  function columnas(headers){
    const indices=new Map(headers.map((h,i)=>[String(h||'').trim().toLowerCase(),i]));
    return (row,name)=>{ const i=indices.get(name); return i===undefined?'':(row[i]??''); };
  }
  function prepararJugadores(rows, pc){
    if(!rows.length) return [];
    const getCol=columnas(rows[0]), registros=[];
    for(let i=1;i<rows.length;i++){
      const r=rows[i];
      if(!r||!r.length) continue;
      const usuario=String(getCol(r,'usuarios')||'').trim();
      if(!usuario||/^\d{4}-\d{2}-\d{2}t/i.test(usuario)||(/^\d+$/.test(usuario)&&usuario.length>=10)) continue;
      const alias=String(getCol(r,'alias')||'').trim();
      const reg={
        usuario:usuario.toLowerCase(), nombre:alias||usuario.toLowerCase(), alias:alias||null,
        estado_revision:String(getCol(r,'estado de revision')||'').trim()||null,
        estado_actual:String(getCol(r,'estado actual')||'').trim()||null,
        cargas_hist:parseIntCsv(getCol(r,'cargas')), descargas_hist:parseIntCsv(getCol(r,'descargas')),
        neto:parseNumCsv(getCol(r,'neto')), score_hist:parseNumCsv(getCol(r,'score')),
        lealtad:parseIntCsv(getCol(r,'lealtad')),
        ultima_actividad:String(getCol(r,'ultima actividad')||'').trim()||null,
        contactado_por:String(getCol(r,'ya contactados')||'').trim()||null,
        recuperado_por:String(getCol(r,'recuperados!')||'').trim()||null, pc_codigo:pc
      };
      const tel=cleanPhone(getCol(r,'telefono'));
      if(tel) reg.telefono=tel;
      registros.push(reg);
    }
    return registros;
  }
  function prepararOperaciones(text, ahora=Date.now()){
    // La declaración opcional de Excel no es un registro CSV.
    text=text.replace(/^\uFEFF/, '').replace(/^\s*sep=,[ \t]*(?:\r\n|\r|\n|$)/i, '');
    const rows=parseCSV(text), aliasSet=new Set(), retiros=[];
    if(!rows.length) return {aliases:[], retiros, totalRows:0};
    const getCol=columnas(rows[0]), desde=new Date(ahora).getTime()-24*60*60*1000;
    let totalRows=0;
    for(let i=1;i<rows.length;i++){
      const row=rows[i], alias=String(getCol(row,'alias')||'').trim().toLowerCase();
      if(!alias||alias==='donplata') continue;
      aliasSet.add(alias); totalRows++;
      const tipo=String(getCol(row,'tipo')||'').trim();
      const cantidad=parseFloat(String(getCol(row,'cantidad')).replace(/,/g,'.')||'0');
      const fecha=getCol(row,'fecha');
      if(tipo==='Deposito de un jugador'&&cantidad<0&&fecha){
        const date=formatos.parseFechaCSV(fecha);
        if(date&&date.getTime()>=desde) retiros.push({alias, fecha:date.toISOString(), monto:Math.abs(cantidad)});
      }
    }
    return {aliases:[...aliasSet], retiros, totalRows};
  }
  return Object.freeze({parseCSV, cleanPhone, parseNumCsv, parseIntCsv, prepararJugadores, prepararOperaciones});
});
