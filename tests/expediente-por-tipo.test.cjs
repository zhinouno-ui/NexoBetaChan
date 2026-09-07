const test = require('node:test');
const assert = require('node:assert/strict');
const operationModal = require('../renderer/portal/operation-modal');

// El expediente del Centro de Solicitudes pintaba la MISMA ficha de carga/retiro para todo.
// Un CAMBIO_CLAVE mostraba monto $0, "Sin billetera", saldos vacios y un paso
// "2. Chunior · Pendiente" que no se completa nunca: el cambio de clave se ejecuta con
// callDrex("cambiarClave") y no genera movimiento en Chunior (744 RESET_CLAVE en 30 dias,
// 0 con numero de movimiento). Estas pruebas fijan que cada tipo muestre SOLO lo que existe.

function construirApi(window) {
  return operationModal.create({
    V154P: { solicitudes: [] },
    alert: () => {},
    billeteras: [],
    cargarBilleteras: () => {},
    cerrarPortalJobModal: () => {},
    document: { getElementById: () => null },
    ejecutarSolicitudPortalSimple: () => {},
    esc: (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c])),
    fecha: (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : ''),
    getBilleraLanding: () => null,
    money: (v) => '$ ' + Number(v || 0).toLocaleString('es-AR'),
    normalizar: (v) => String(v || '').toUpperCase(),
    pcAliasesHist: () => ['P2'],
    pcOperativa: 'P2',
    portalCheckDiscrepancia: () => {},
    setTimeout: () => {},
    supabaseClient: null,
    toast: () => {},
    v154pRegistrarParcial: () => {},
    window: window || {}
  });
}

const CAMBIO_CLAVE = {
  fuente: 'SOLICITUD', id: '188138', tipo: 'CAMBIO_CLAVE', usuario: 'pruebaxx', monto: 0,
  estado: 'PENDIENTE', fecha: '2026-09-06T13:52:00Z', chunior_movimiento_id: null,
  _raw: {
    ID: 188138, TIPO: 'CAMBIO_CLAVE', USUARIO: 'pruebaxx', ESTADO: 'PENDIENTE',
    TELEFONO: '1134970581', MONTO_DECLARADO: 0, FECHA_CREACION: '2026-09-06T13:52:00Z',
    METADATA: { password_nuevo: 'nueva123' }
  }
};

const DEPOSITO_SR = {
  fuente: 'OPERACION', id: 991, tipo: 'DEPOSITO_SR', usuario: 'caja 2 · evento',
  monto: 13000, estado: 'OK', fecha: '2026-09-07T11:49:00Z',
  chunior_movimiento_id: '9614180', billetera_nombre: 'BANCO',
  _raw: {
    id: 991, tipo: 'DEPOSITO_SR', usuario: 'caja 2 · evento', monto: 13000, estado: 'OK',
    created_at: '2026-09-07T11:49:00Z', chunior_movimiento_id: '9614180',
    billetera_nombre: 'BANCO', origen: 'MANUAL', notas: 'Depósito sin reclamar · caja 2'
  }
};

const CARGA = {
  fuente: 'SOLICITUD', id: '188100', tipo: 'CARGA', usuario: 'pruebaxx', monto: 5000,
  estado: 'ACREDITADA', fecha: '2026-09-06T12:20:00Z', chunior_movimiento_id: '9614001',
  billetera_nombre: 'SALVATIERRA X',
  _raw: {
    ID: 188100, TIPO: 'CARGA', USUARIO: 'pruebaxx', ESTADO: 'ACREDITADA', MONTO_DECLARADO: 5000,
    chunior_movimiento_id: '9614001', BILLETERA_NOMBRE: 'SALVATIERRA X', TITULAR: 'JUAN PEREZ',
    DESTINO: 'ali.as.mp', SALDO_PRE: 100, SALDO_POST: 5100,
    FECHA_CREACION: '2026-09-06T12:20:00Z', METADATA: {}
  }
};

test('el cambio de clave no inventa Chunior, billetera ni monto', () => {
  const html = construirApi().construirDossierCompletoHtml(CAMBIO_CLAVE);

  assert.ok(!html.includes('Solicitud no seleccionada'), 'la ficha no se armó');
  assert.match(html, /CAMBIO DE CLAVE/);
  assert.match(html, /Clave nueva/);
  assert.match(html, /nueva123/, 'tiene que mostrar la clave que pidió el jugador');
  assert.match(html, /Agente \/ Drex/, 'tiene que decir dónde se ejecuta de verdad');
  assert.match(html, /No corresponde/, 'tiene que decir que no genera movimiento en Chunior');

  for (const prohibido of [
    'N° Movimiento Chunior', 'Billetera asignada', 'Saldos en casino',
    'CBU / CVU', 'Monto de la operación'
  ]) {
    assert.ok(!html.includes(prohibido), 'no debería mostrar "' + prohibido + '"');
  }
  assert.ok(!/2\. Chunior/.test(html), 'el flujo no puede tener un paso por Chunior');
});

test('un movimiento de Chunior abre ficha propia con su N° y sus notas', () => {
  const html = construirApi().construirDossierCompletoHtml(DEPOSITO_SR);

  assert.ok(!html.includes('Solicitud no seleccionada'), 'la fila de Chunior quedaba muerta');
  assert.match(html, /DEPÓSITO SIN RECLAMAR/);
  assert.match(html, /Detalle del movimiento/, 'no es un jugador, es un movimiento');
  assert.match(html, /9614180/, 'el N° de movimiento es el dato para cotejar');
  assert.match(html, /Notas de la operación/);
  assert.ok(!html.includes('Clave nueva'));
  assert.ok(!html.includes('Agente / Drex'));
});

test('la carga del portal sigue mostrando todo lo suyo', () => {
  const html = construirApi().construirDossierCompletoHtml(CARGA);

  assert.match(html, /N° Movimiento Chunior/);
  assert.match(html, /9614001/);
  // La cuenta declarada de esta carga (ali.as.mp) NO es la billetera asignada
  // (SALVATIERRA X): eso es justo lo que hay que avisar.
  assert.match(html, /Transfirió a otra billetera/);
  assert.match(html, /Monto de la operación/);
  assert.match(html, /Saldos en casino/);
  assert.ok(!html.includes('Clave nueva'));
});

test('sin clave en el metadata se avisa, no se finge', () => {
  const sinClave = JSON.parse(JSON.stringify(CAMBIO_CLAVE));
  sinClave._raw.METADATA = {};
  const html = construirApi().construirDossierCompletoHtml(sinClave);

  assert.match(html, /No llegó ninguna clave/, 'tiene que avisar que se aplica la del sistema');
});

test('la clave manual se lee de las notas del historial', () => {
  // registrarEnHistorial escribe notas: 'clave → xxxx' en los RESET_CLAVE manuales.
  const manual = {
    fuente: 'OPERACION', id: 77, tipo: 'RESET_CLAVE', usuario: 'pruebaxx', monto: 0,
    estado: 'OK', fecha: '2026-09-07T09:00:00Z',
    _raw: {
      id: 77, tipo: 'RESET_CLAVE', usuario: 'pruebaxx', monto: 0, estado: 'OK',
      origen: 'MANUAL', created_at: '2026-09-07T09:00:00Z', notas: 'clave → zorro77'
    }
  };
  const html = construirApi().construirDossierCompletoHtml(manual);

  assert.match(html, /zorro77/, 'la clave está en las notas y hay que mostrarla');
});

test('si la cuenta declarada ES la billetera asignada, no se repite el dato', () => {
  // Antes la ficha mostraba "Cuenta de transferencia: SALVATIERRA X · paola.111.olmo.mp" y
  // justo al lado "Billetera asignada: SALVATIERRA X (paola.111.olmo.mp)": el mismo dato dos
  // veces. En una carga el destino declarado ES nuestra billetera; sólo interesa si difiere.
  const misma = JSON.parse(JSON.stringify(CARGA));
  misma._raw.DESTINO = 'SALVATIERRA X · paola.111.olmo.mp';
  misma._raw.METADATA = { billetera_alias: 'paola.111.olmo.mp' };
  const html = construirApi().construirDossierCompletoHtml(misma);

  assert.ok(!html.includes('Transfirió a otra billetera'), 'es la misma billetera, no hay nada que avisar');
  assert.ok(!html.includes('Cuenta de transferencia'), 'no se repite el dato de la billetera');
  assert.match(html, /Billetera asignada/, 'la billetera sí se muestra, una vez');
});

test('la metadata vacía no dibuja la caja de contexto técnico', () => {
  const html = construirApi().construirDossierCompletoHtml(DEPOSITO_SR);
  assert.ok(!html.includes('Contexto técnico'), 'un "{}" ocupa lugar y no dice nada');

  const conMeta = JSON.parse(JSON.stringify(CARGA));
  conMeta._raw.METADATA = { retiro_parcial: { total: 130000 } };
  const html2 = construirApi().construirDossierCompletoHtml(conMeta);
  assert.match(html2, /Contexto técnico/, 'con datos adentro sí se muestra');
});

test('una operación cerrada sin N° ofrece buscarlo en Chunior', () => {
  const sinN = {
    fuente: 'OPERACION', id: 4321, tipo: 'CARGA', usuario: 'pruebaxx', monto: 5000,
    estado: 'OK', fecha: '2026-09-06T12:20:00Z', chunior_movimiento_id: null,
    billetera_nombre: 'SALVATIERRA X', historial_id: 4321,
    _raw: {
      id: 4321, tipo: 'CARGA', usuario: 'pruebaxx', monto: 5000, estado: 'OK',
      origen: 'PORTAL', created_at: '2026-09-06T12:20:00Z', billetera_nombre: 'SALVATIERRA X'
    }
  };
  const html = construirApi().construirDossierCompletoHtml(sinN);

  assert.match(html, /Buscar en Chunior/, 'la operación se hizo: falta el N°, hay que poder ir a buscarlo');
  assert.match(html, /expedienteBuscarMovChunior\('4321'/, 'tiene que saber en qué fila guardar el N°');
});

test('una operación todavía abierta no ofrece buscar un N° que aún no existe', () => {
  const abierta = {
    fuente: 'SOLICITUD', id: '187988', tipo: 'CARGA', usuario: 'pruebaxx', monto: 5000,
    estado: 'EN_REVISION', fecha: '2026-09-06T12:20:00Z', chunior_movimiento_id: null,
    billetera_nombre: 'SALVATIERRA X',
    _raw: {
      ID: 187988, TIPO: 'CARGA', USUARIO: 'pruebaxx', ESTADO: 'EN_REVISION',
      MONTO_DECLARADO: 5000, BILLETERA_NOMBRE: 'SALVATIERRA X',
      FECHA_CREACION: '2026-09-06T12:20:00Z', METADATA: {}
    }
  };
  const html = construirApi().construirDossierCompletoHtml(abierta);

  assert.ok(!html.includes('Buscar en Chunior'), 'todavía no se ejecutó: no hay nada que buscar');
  assert.match(html, /Todavía no se ejecutó/);
  assert.match(html, /Se leen al ejecutar/, 'los saldos no faltan, todavía no se leyeron');
});

test('un movimiento con N° ofrece editarlo, apuntando a su fila de historial', () => {
  const html = construirApi().construirDossierCompletoHtml(DEPOSITO_SR);

  assert.match(html, /✏️ Editar/, 'monto y nota se tienen que poder corregir desde acá');
  assert.match(html, /expedienteEditarMovimiento\('991'\)/, 'tiene que apuntar a la fila correcta');
  assert.match(html, /operador que lo anotó/, 'el botón avisa la regla antes de apretarlo');
});

test('en un retiro la cuenta de cobro no es una alarma, es el dato', () => {
  // El destino de un retiro es la cuenta del jugador: que NO sea nuestra billetera es lo
  // normal. Marcarlo en ámbar como "cobra en otra cuenta" seria alarma en cada retiro.
  const retiro = {
    fuente: 'SOLICITUD', id: '81071', tipo: 'RETIRO', usuario: 'noex90', monto: 50000,
    estado: 'PAGADA', fecha: '2026-09-07T14:12:00Z', billetera_nombre: 'Prueba.mp',
    _raw: {
      ID: 81071, TIPO: 'RETIRO', USUARIO: 'noex90', ESTADO: 'PAGADA', MONTO_DECLARADO: 50000,
      BILLETERA_NOMBRE: 'Prueba.mp', TITULAR: 'Probando parcial', DESTINO: 'cbu.del.jugador',
      FECHA_CREACION: '2026-09-07T14:12:00Z', METADATA: {}
    }
  };
  const html = construirApi().construirDossierCompletoHtml(retiro);

  assert.match(html, /Cuenta de cobro del jugador/);
  assert.match(html, /cbu\.del\.jugador/);
  assert.ok(!html.includes('⚠ Cobra en otra cuenta'), 'no es una anomalía, es el destino del pago');
  assert.ok(!html.includes('Transfirió a otra billetera'), 'eso es de cargas, no de retiros');
});

test('en un retiro, destino igual a nuestra billetera no se repite', () => {
  const retiro = {
    fuente: 'SOLICITUD', id: '81072', tipo: 'RETIRO', usuario: 'pruebaxx', monto: 130000,
    estado: 'PAGADA', fecha: '2026-09-07T14:12:00Z', billetera_nombre: 'Prueba.mp',
    _raw: {
      ID: 81072, TIPO: 'RETIRO', USUARIO: 'pruebaxx', ESTADO: 'PAGADA', MONTO_DECLARADO: 130000,
      BILLETERA_NOMBRE: 'Prueba.mp', DESTINO: 'Prueba.mp',
      FECHA_CREACION: '2026-09-07T14:12:00Z', METADATA: {}
    }
  };
  const html = construirApi().construirDossierCompletoHtml(retiro);
  assert.ok(!html.includes('Cuenta de cobro del jugador'), 'es el mismo valor que la billetera');
});

test('el N° encontrado se dibuja aunque la operación sea vieja y esté fuera de la ventana', () => {
  // Caso real: carga del 16/7 con la ventana en 12 h. Se busca el N° en Chunior, se guarda,
  // pero cargarHistorial() no trae esa fila porque quedó fuera del período. Antes de esto la
  // ficha seguía diciendo "Sin N° anotado" con el número ya en la base.
  const solicitudVieja = {
    ID: 187500, TIPO: 'CARGA', USUARIO: 'pruebaxx', ESTADO: 'ACREDITADA',
    MONTO_DECLARADO: 100000, BILLETERA_NOMBRE: 'SALVATIERRA X',
    FECHA_CREACION: '2026-07-16T16:34:00Z', METADATA: {},
    chunior_movimiento_id: '9190812'          // lo escribió expedienteBuscarMovChunior
  };
  const item = {
    fuente: 'SOLICITUD', id: '187500', tipo: 'CARGA', usuario: 'pruebaxx', monto: 100000,
    estado: 'ACREDITADA', fecha: '2026-07-16T16:34:00Z',
    billetera_nombre: 'SALVATIERRA X', chunior_movimiento_id: '9190812',
    _raw: solicitudVieja
  };
  const html = construirApi().construirDossierCompletoHtml(item);

  assert.match(html, /9190812/, 'el número está guardado: hay que mostrarlo');
  assert.ok(!html.includes('Sin N° anotado'), 'ya no falta el número');
  assert.ok(!html.includes('Buscar en Chunior'), 'ya no hay nada que buscar');
});

test('el paso 2 del flujo no pone un saldo donde va el N° de movimiento', () => {
  const sinN = {
    fuente: 'OPERACION', id: 555, tipo: 'CARGA', usuario: 'pruebaxx', monto: 100000,
    estado: 'OK', fecha: '2026-07-16T16:34:00Z', chunior_movimiento_id: null,
    billetera_nombre: 'SALVATIERRA X', historial_id: 555,
    _raw: {
      id: 555, tipo: 'CARGA', usuario: 'pruebaxx', monto: 100000, estado: 'OK',
      origen: 'PORTAL', created_at: '2026-07-16T16:34:00Z',
      billetera_nombre: 'SALVATIERRA X', saldo_pre: 2636, saldo_post: 102636
    }
  };
  const html = construirApi().construirDossierCompletoHtml(sinN);
  const paso = (html.match(/2\. Chunior[\s\S]{0,140}?<\/div>/) || [''])[0];

  assert.ok(!/2\.636/.test(paso), 'el saldo previo no es un número de movimiento');
  assert.match(paso, /Sin N° anotado/);
});
