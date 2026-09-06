const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {test}=require('node:test');
const core=require('../renderer/domain/conciliacion.js');
const caso=(case_id,wallet_id,tipo,monto_disponible)=>({case_id,wallet_id,tipo,monto_disponible});
const retiro=(id,billetera_id,monto,extra={})=>({id,billetera_id,tipo:'RETIRO',monto,...extra});

test('match exacto usa retiro de billetera sobrante, monto absoluto y excluye transferencias',()=>{
  const casos=[caso('f','A','FALTANTE',100),caso('s','B','SOBRANTE',100)];
  const elegido=retiro('r','B',-100);
  const movs=[retiro('otro','A',100),retiro('interno','B',100,{esTransferenciaInterna:true}),elegido];
  const anterior=JSON.stringify({casos,movs});
  assert.deepEqual(core.match(casos,movs),{sugerencias:[{
    tipo:'MOVER_RETIRO',confianza:'EXACTA',caso_faltante:'f',caso_sobrante:'s',pares_posibles:['s'],candidatos:[elegido]
  }],combinaciones:[],explicaciones:[]});
  assert.equal(JSON.stringify({casos,movs}),anterior);
});

test('múltiples pares o retiros permanecen ambiguos y conservan orden de candidatos',()=>{
  const f=caso('f','A','FALTANTE',100), s=caso('s','B','SOBRANTE',100), r1=retiro('1','B',100),r2=retiro('2','B',100);
  let result=core.match([f,s],[r1,r2]).sugerencias[0];
  assert.equal(result.confianza,'AMBIGUA');
  assert.deepEqual(result.candidatos,[r1,r2]);
  result=core.match([f,s,caso('s2','C','SOBRANTE',100)],[r1]).sugerencias[0];
  assert.equal(result.confianza,'AMBIGUA');
  assert.deepEqual(result.pares_posibles,['s','s2']);
  assert.deepEqual(result.candidatos,[r1]);
});

test('sin candidatos, sin par o misma billetera no aparece coincidencia exacta',()=>{
  assert.deepEqual(core.match(undefined,null),{sugerencias:[],combinaciones:[],explicaciones:[]});
  assert.equal(core.match([caso('f','A','FALTANTE',100),caso('s','B','SOBRANTE',100)],[]).sugerencias[0].confianza,'AMBIGUA');
  assert.equal(core.match([caso('f','A','FALTANTE',100),caso('s','A','SOBRANTE',100)],[]).sugerencias.length,0);
  assert.equal(core.match([caso('f','A','FALTANTE',100),caso('s','B','SOBRANTE',99)],[]).sugerencias.length,0);
  assert.equal(core.match([caso('f','A','FALTANTE',0),caso('s','B','SOBRANTE',0)],[]).sugerencias.length,0);
});

test('un sobrante único se reserva una vez; combinaciones sólo se sugieren',()=>{
  const cases=[caso('f','A','FALTANTE',100),caso('f2','C','FALTANTE',100),caso('s','B','SOBRANTE',100)];
  assert.equal(core.match(cases,[retiro('r','B',100)]).sugerencias.length,1);
  const result=core.match([caso('f','A','FALTANTE',150),caso('s1','B','SOBRANTE',100),caso('s2','C','SOBRANTE',50)],[]);
  assert.deepEqual(result.combinaciones,[{tipo:'COMBINACION',caso:'f',partes:['s1','s2']}]);
  assert.equal(result.sugerencias.length,0);
});

test('depósitos con usuario pegado se excluyen de explicaciones automáticas',()=>{
  const sinUsuario={id:'d1',tipo:'DEPOSITO_SR',monto:-100,usuario:'  '};
  const conUsuario={id:'d2',tipo:'DEPOSITO_SR',monto:100,usuario:'ana'};
  assert.deepEqual(core.match([caso('s','B','SOBRANTE',100)],[sinUsuario,conUsuario]).explicaciones,
    [{tipo:'DEPO_EXISTENTE',caso:'s',candidatos:[sinUsuario]}]);
});

test('turnos argentinos respetan límites, cambio de año y timestamp cero',()=>{
  for(const [ts,id,inicio] of [
    ['2026-01-01T02:59:59-03:00','2025-12-31_22-06','2026-01-01T01:00:00.000Z'],
    ['2026-09-05T05:59:59-03:00','2026-09-04_22-06','2026-09-05T01:00:00.000Z'],
    ['2026-09-05T06:00:00-03:00','2026-09-05_06-14','2026-09-05T09:00:00.000Z'],
    ['2026-09-05T14:00:00-03:00','2026-09-05_14-22','2026-09-05T17:00:00.000Z'],
    ['2026-09-05T22:00:00-03:00','2026-09-05_22-06','2026-09-06T01:00:00.000Z']
  ]){
    assert.equal(core.turnoId(ts),id);
    assert.equal(new Date(core.inicioTurnoMs(ts)).toISOString(),inicio);
  }
  assert.equal(core.turnoId(0),'1969-12-31_14-22');
});

test('turno no cambia con zona horaria del sistema operativo',()=>{
  const file=path.join(__dirname,'../renderer/domain/conciliacion.js');
  for(const TZ of ['UTC','America/Argentina/Buenos_Aires','Asia/Tokyo']){
    const result=spawnSync(process.execPath,['-e',`const c=require(${JSON.stringify(file)});console.log(c.turnoId('2026-09-05T08:00:00Z'))`],{env:{...process.env,TZ},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'2026-09-04_22-06');
  }
});

test('movimientos filtra fecha/estado, conserva referencia original y construye índice',()=>{
  const desde=Date.parse('2026-09-05T09:00:00Z');
  const fila={id:'r',created_at:'2026-09-05T09:00:00Z',estado:'ok',tipo:'retiro',monto:-12,billetera_id:7,notas:'Transferencia interna'};
  const filas=[fila,{...fila,id:'antes',created_at:'2026-09-05T08:59:59Z'},{...fila,id:'rechazada',estado:'ERROR'},{...fila,id:'fecha',created_at:'inválido'}];
  const movimientos=core.movimientosTurno(filas,desde);
  assert.equal(movimientos.length,1);
  assert.equal(movimientos[0]._fila,fila);
  assert.equal(movimientos[0].esTransferenciaInterna,true);
  assert.equal(movimientos[0].monto,12);
  assert.deepEqual(core.indexarMovimientos(movimientos).get('7'),movimientos);
  assert.equal(core.movimientosTurno(filas,desde,['ERROR'])[0].id,'rechazada');
});

test('declaración separa pesos y residuo de centavos sin crear diferencias ficticias',()=>{
  assert.deepEqual(core.declaracion({wallet_id:'A',nombre:'Banco',saldo_chunior:999.8},'1.000'),{
    wallet_id:'A',nombre:'Banco',chunior:999.8,decl:1000,dif:0,resid:0.2
  });
  assert.equal(core.declaracion({saldo_chunior:1200},'1.000').dif,-200);
});

test('adaptadores globales ejecutan los módulos de dominio en un navegador aislado',()=>{
  const context=vm.createContext({window:{addEventListener(){}}});
  for(const file of ['domain/formatos.js','domain/csv.js','domain/conciliacion.js','core/utilidades-interfaz.js','core/jugadores-importacion.js','core/conciliacion.js']){
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../renderer',file),'utf8'),context,{filename:file});
  }
  assert.equal(context.money(1234),require('../renderer/domain/formatos.js').money(1234));
  assert.equal(context.parseCSV('a,"b,c"')[0][1],'b,c');
  assert.equal(context._cotejoTurnoId('2026-09-05T08:00:00Z'),'2026-09-04_22-06');
  assert.equal(context._cotejoMatch([],[]).sugerencias.length,0);
});
