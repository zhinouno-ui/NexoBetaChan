const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const formatos=require('../renderer/domain/formatos.js');
const zona='America/Argentina/Buenos_Aires';

test('moneda conserva exactamente formato, redondeo y entradas del panel',()=>{
  for(const value of [undefined,null,'',0,-0,1,-1,1234567.89,-1234.5,'4500','inválido',Infinity]){
    assert.equal(formatos.money(value),Number(value||0).toLocaleString('es-AR',{
      style:'currency',currency:'ARS',maximumFractionDigits:0
    }));
  }
  assert.equal(formatos.normalizar('  ábC  '),'ÁBC');
});

test('fecha y hora mantienen salida nativa, zona AR y valores inválidos',()=>{
  for(const raw of ['2026-09-05T01:23:00Z','2026-01-01T03:00:00Z',new Date('2025-12-31T23:59:00Z')]){
    assert.equal(formatos.formatFecha(raw),new Date(raw).toLocaleString('es-AR',{
      timeZone:zona,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false
    }).replace(',',' ·'));
    assert.equal(formatos.formatearHoraChat(raw),new Date(raw).toLocaleTimeString('es-AR',{
      timeZone:zona,hour:'2-digit',minute:'2-digit',hour12:false
    }));
  }
  assert.equal(formatos.formatFecha('no es fecha'),'no es fecha');
  assert.equal(formatos.formatearHoraChat('no es fecha'),'');
  for(const raw of [0,null,undefined,'']) assert.equal(formatos.formatFecha(raw),'');
});

test('día argentino, CSV de agentes y turnos no dependen del día UTC',()=>{
  assert.equal(formatos.inicioDiaArgentina('2026-01-01T02:59:59Z').toISOString(),'2025-12-31T03:00:00.000Z');
  assert.equal(formatos.inicioDiaArgentina('2026-01-01T03:00:00Z').toISOString(),'2026-01-01T03:00:00.000Z');
  assert.equal(formatos.parseFechaCSV('05/29/2026 15:50:56').toISOString(),'2026-05-29T18:50:56.000Z');
  assert.equal(formatos.parseFechaCSV('5/9/2026').toISOString(),'2026-05-09T03:00:00.000Z');
  assert.equal(formatos.parseFechaCSV('2026-09-05T12:00:00Z').toISOString(),'2026-09-05T12:00:00.000Z');
  assert.equal(formatos.parseFechaCSV('inválido'),null);
  assert.equal(formatos.parseFechaCSV(''),null);
  for(const [hora,turno] of [['05:59:59','TN'],['06:00:00','TM'],['13:59:59','TM'],['14:00:00','TT'],['21:59:59','TT'],['22:00:00','TN']]){
    assert.equal(formatos.getTurno('2026-09-05T'+hora+'-03:00'),turno);
  }
});

test('miles y signo conservan la edición de montos incompletos',()=>{
  for(const [input,plain,signed,number] of [[null,'','',0],['0','','',0],['-','','-',-0],['-1.500','1.500','-1.500',-1500],[' $ 23.456 ','23.456','23.456',23456]]){
    assert.equal(formatos.cotejoFmtMiles(input),plain);
    assert.equal(formatos.fmtMilesConSigno(input),signed);
    assert.equal(formatos.parseMontoConSigno(input),number);
  }
});

test('el navegador con globals de Electron recibe la API y reutiliza Intl',()=>{
  let num=0,date=0;
  const context=vm.createContext({window:{},module:{exports:{}},Intl:{
    NumberFormat:class extends Intl.NumberFormat { constructor(...args){ super(...args);num++; } },
    DateTimeFormat:class extends Intl.DateTimeFormat { constructor(...args){ super(...args);date++; } }
  }});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer/domain/formatos.js'),'utf8'),context);
  const api=context.NodoDomain.formatos;
  for(let i=0;i<100;i++){
    api.money(i);api.cotejoFmtMiles(i+1);api.fmtMilesConSigno(-i);
    api.formatFecha('2026-09-05T12:00:00Z');api.formatearHoraChat('2026-09-05T12:00:00Z');api.inicioDiaArgentina(0);
  }
  assert.equal(num,2);
  assert.equal(date,3);
});
