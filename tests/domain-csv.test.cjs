const assert=require('node:assert/strict');
const {test}=require('node:test');
const csv=require('../renderer/domain/csv.js');

test('CSV respeta BOM, comas, comillas escapadas y campos multilínea',()=>{
  assert.deepEqual(csv.parseCSV('\uFEFFusuario,nota,importe\r\nana,"dice ""hola"", sigue\r\nabajo","1.234,50"\r\n'),[
    ['usuario','nota','importe'],['ana','dice "hola", sigue\r\nabajo','1.234,50']
  ]);
  assert.deepEqual(csv.parseCSV('a,b\rc,d\r'),[['a','b'],['c','d']]);
  assert.deepEqual(csv.parseCSV('a,b\nc,d\n'),[['a','b'],['c','d']]);
  assert.deepEqual(csv.parseCSV('a,'),[['a','']]);
  assert.deepEqual(csv.parseCSV('""'),[['']]);
  assert.deepEqual(csv.parseCSV(''),[]);
});

test('conversiones de CSV conservan convención decimal argentina y teléfonos',()=>{
  assert.equal(csv.parseNumCsv('1.234,56'),1234.56);
  assert.equal(csv.parseNumCsv('-1.234,56'),-1234.56);
  assert.equal(csv.parseNumCsv('no'),0);
  assert.equal(csv.parseIntCsv(' 12 ops'),12);
  assert.equal(csv.parseIntCsv(undefined),0);
  assert.equal(csv.cleanPhone('+54 (11) 4444-5555'),'541144445555');
  assert.equal(csv.cleanPhone('sin teléfono'),null);
});

test('preparación de jugadores filtra metadatos y conserva campos y fallbacks',()=>{
  const rows=csv.parseCSV('Usuarios,Alias,Neto,Telefono,Cargas,Estado actual\n ANA ,"Ana, A.","1.234,50",+54 11,12, CONTACTAR \nBeto,,,,,\n2026-09-05T12:00:00,,,,,\n12345678901,,,,,\n,,,,,');
  const copy=JSON.stringify(rows), registros=csv.prepararJugadores(rows,'PC1');
  assert.equal(JSON.stringify(rows),copy);
  assert.equal(registros.length,2);
  assert.deepEqual(registros[0],{
    usuario:'ana',nombre:'Ana, A.',alias:'Ana, A.',estado_revision:null,estado_actual:'CONTACTAR',
    cargas_hist:12,descargas_hist:0,neto:1234.5,score_hist:0,lealtad:0,ultima_actividad:null,
    contactado_por:null,recuperado_por:null,pc_codigo:'PC1',telefono:'5411'
  });
  assert.equal(registros[1].nombre,'beto');
  assert.equal(Object.hasOwn(registros[1],'telefono'),false);
});

test('operaciones usa el mismo parser y cuenta usuarios únicos y retiros de 24 h',()=>{
  const text='\uFEFFsep=,\r\nFecha,Cantidad,Tipo,Alias,Nota\r\n'
    +'09/04/2026 12:00:00,"-1,50",Deposito de un jugador, ANA ,"a ""b""\r\nc"\r\n'
    +'09/04/2026 11:59:59,-10,Deposito de un jugador,ana,anterior\r\n'
    +'09/05/2026 10:00:00,20,Deposito de un jugador,BETO,positivo\r\n'
    +'09/05/2026 10:00:00,-30,Otro,Beto,no cuenta\r\n'
    +'fecha inválida,-40,Deposito de un jugador,ana,inválido\r\n'
    +'09/05/2026 10:00:00,-100,Deposito de un jugador,donplata,sistema\r\n';
  assert.deepEqual(csv.prepararOperaciones(text,'2026-09-05T15:00:00Z'),{
    aliases:['ana','beto'],totalRows:5,retiros:[{alias:'ana',fecha:'2026-09-04T15:00:00.000Z',monto:1.5}]
  });
  assert.deepEqual(csv.prepararOperaciones(''),{aliases:[],retiros:[],totalRows:0});
});
