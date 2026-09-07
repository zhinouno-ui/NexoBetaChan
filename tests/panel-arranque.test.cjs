const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Los tests de arriba prueban funciones sueltas importándolas como módulo. Esto prueba lo que
// de verdad corre en el panel: el bundle generado, en el mismo orden que el HTML. Sirve para
// agarrar lo que más ruido hizo — que algo tire al arrancar, o que una función quede sin
// definir — antes de que se vea en pantalla como "no anda".

const RAIZ = path.join(__dirname, '..');
const noop = () => {};

function elemento() {
  return {
    style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, appendChild: noop, remove: noop,
    addEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
    options: [], value: '', textContent: '', innerHTML: ''
  };
}

function arrancarPanel(opciones) {
  const doc = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => elemento(), addEventListener: noop,
    body: elemento(), head: elemento(), documentElement: elemento(), readyState: 'complete'
  };
  const sb = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    document: doc,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout: noop, clearInterval: noop,
    navigator: { userAgent: 'node', clipboard: {} },
    fetch: () => Promise.resolve({ json: () => ({}), ok: true }),
    location: { href: 'file:///panel', search: '' },
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    alert: noop, confirm: () => false, requestAnimationFrame: () => 0,
    Notification: function () {}, CustomEvent: function () {}, Event: function () {}
  };
  // supabaseClient es un `const` del bundle: se arma con window.supabase.createClient al
  // cargar, asi que el cliente falso hay que dejarlo puesto ANTES, no despues.
  if (opciones && opciones.rpc) {
    sb.supabase = { createClient: () => ({ rpc: opciones.rpc, from: () => ({}), channel: () => ({ on: () => ({ subscribe: noop }) }) }) };
  }
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);

  // El orden EXACTO que declara el HTML. Si el test carga de menos, una función parece no
  // existir y el test miente: ya pasó dos veces (faltaba js-modules.js y normalizar() tiraba
  // NodoDomain undefined; faltaba js-jugadores-crm.js y el CRM parecía no haberse construido).
  // Se lee del HTML generado en vez de repetir la lista a mano, así no se desincroniza.
  const html = fs.readFileSync(path.join(RAIZ, "NODO · OPERATIVO LITE.htm"), "utf8");
  const orden = [...html.matchAll(/src="renderer\/generated\/(js-[a-z-]+\.js)"/g)].map((m) => m[1]);
  assert.ok(orden.length >= 20, "el HTML tiene que declarar los bundles");
  for (const archivo of orden) {
    const src = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', archivo), 'utf8');
    new vm.Script(src, { filename: archivo }).runInContext(sb, { timeout: 15000 });
  }
  return sb;
}

test('el bundle del panel arranca sin tirar', () => {
  assert.doesNotThrow(arrancarPanel);
});

test('las funciones que usa la pantalla quedan definidas', () => {
  const sb = arrancarPanel();
  const necesarias = [
    'cargarHistorial', 'renderHistorialUnificado', 'setHistorialPeriodo',
    'buscarHistorialServidor', 'expedienteBuscarMovChunior', 'expedienteEditarMovimiento',
    'expedienteVerEdiciones', 'cerrarRetiroSaldado', 'getBilleraLanding', '_billeteraVieja'
  ];
  const faltan = necesarias.filter((f) => typeof sb[f] !== 'function');
  assert.deepEqual(faltan, [], 'quedaron sin definir: ' + faltan.join(', '));
});

test('_billeteraVieja avisa sólo cuando corresponde', () => {
  const sb = arrancarPanel();
  // 'billeteras' es un let del bundle: se llena desde adentro, no desde el sandbox.
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-castro",NOMBRE_VISIBLE:"CASTRO",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-gio",NOMBRE_VISIBLE:"GIORDANO",ACTIVA:"SI"});', sb);

  assert.equal(vm.runInContext('(getBilleraLanding()||{}).NOMBRE_VISIBLE', sb), 'CASTRO');

  const vieja = { pendiente: true, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} };
  const r = sb._billeteraVieja(vieja);
  assert.ok(r, 'una carga pendiente con la billetera anterior tiene que avisar');
  assert.equal(r.vieja, 'GIORDANO');
  assert.equal(r.actual, 'CASTRO');

  // Y por nombre solo, sin id: el metadata viejo no siempre trae billetera_id.
  const soloNombre = sb._billeteraVieja({ pendiente: true, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: '', _raw: {} });
  assert.ok(soloNombre, 'sin id tiene que comparar por nombre');

  // Los que NO tienen que avisar.
  const sinAviso = [
    ['con la billetera activa', { pendiente: true, tipo: 'CARGA', billetera_nombre: 'CASTRO', billetera_id: 'b-castro', _raw: {} }],
    ['ya cerrada', { pendiente: false, tipo: 'CARGA', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} }],
    ['retiro (pagamos nosotros)', { pendiente: true, tipo: 'RETIRO', billetera_nombre: 'GIORDANO', billetera_id: 'b-gio', _raw: {} }],
    ['sin billetera', { pendiente: true, tipo: 'CARGA', billetera_nombre: '', billetera_id: '', _raw: {} }]
  ];
  for (const [caso, it] of sinAviso) {
    assert.equal(sb._billeteraVieja(it), null, 'no debería avisar: ' + caso);
  }
});

test('la ventana del historial se mide en tiempo y el turno nunca baja de 12 h', () => {
  const sb = arrancarPanel();
  const v = vm.runInContext('_histVentana()', sb);
  assert.ok(v.horas >= 12, 'el turno recién empezado igual tiene que mostrar el anterior');
  assert.ok(v.limite > 0);
  assert.ok(new Date(v.desde).getTime() < Date.now(), 'la ventana arranca en el pasado');

  vm.runInContext('window._HIST_PERIODO="D30"', sb);
  const v30 = vm.runInContext('_histVentana()', sb);
  assert.equal(v30.horas, 720, '30 días son 720 h');
});

test('el CRM quedó con un solo buscador, sin filtros ni base local', () => {
  const sb = arrancarPanel();

  for (const f of ['crmBuscarServidor', 'crmBusqTexto', 'crmBusqCantidad']) {
    assert.equal(typeof sb[f], 'function', 'falta ' + f);
  }
  assert.equal(sb._crmBusq.cantidad, 10, 'arranca trayendo 10');

  // Lo que se sacó no puede seguir colgando.
  for (const f of ['mostrarBaseLocalJugadores', 'mostrarBaseLocalJugadoresRefiltrar',
                   'crmRegistradosCargar', 'crmRegistradosIr']) {
    assert.equal(typeof sb[f], 'undefined', f + ' se sacó');
  }

  // Pero el almacén que leen el perfil, el alta y Nexo tiene que seguir.
  assert.equal(typeof sb.jugadorRegistrarDato, 'function', 'el dato lo leen otras tres cosas');
});

test('el desplegable de cantidad se queda dentro de lo razonable', () => {
  const sb = arrancarPanel();
  sb.crmBuscarServidor = () => {};      // no tocar la red

  sb.crmBusqCantidad('50');
  assert.equal(sb._crmBusq.cantidad, 50);

  sb.crmBusqCantidad('99999');
  assert.equal(sb._crmBusq.cantidad, 200, 'se corta en 200, igual que la RPC');

  sb.crmBusqCantidad('0');
  assert.equal(sb._crmBusq.cantidad, 10, '0 no es una cantidad: vuelve al default');

  sb.crmBusqCantidad('cualquier cosa');
  assert.equal(sb._crmBusq.cantidad, 10, 'sin número válido vuelve al default');
});

test('una respuesta vieja no pisa a la nueva (era el "Cargando…" eterno)', async () => {
  // renderCRM repinta la vista varias veces. Con el candado booleano anterior, la segunda
  // llamada se salteaba y la respuesta de la primera terminaba escrita en una caja que ya no
  // estaba en pantalla: la visible se quedaba en "Cargando…" para siempre.
  let resolverPrimera;
  let llamada = 0;
  const sb = arrancarPanel({
    rpc: () => {
      llamada++;
      if (llamada === 1) return new Promise((r) => { resolverPrimera = r; });
      return Promise.resolve({ data: [{ usuario: 'nuevo', total: 1 }], error: null });
    }
  });

  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  const primera = sb.crmBuscarServidor();     // queda colgada a propósito
  const segunda = sb.crmBuscarServidor();     // NO se saltea: pisa a la primera
  await segunda;
  assert.match(caja.innerHTML, /nuevo/, 'la segunda búsqueda tiene que pintar');

  resolverPrimera({ data: [{ usuario: 'viejo', total: 1 }], error: null });
  await primera;
  assert.match(caja.innerHTML, /nuevo/, 'la respuesta vieja no puede pisar a la nueva');
  assert.ok(!/viejo/.test(caja.innerHTML));
  assert.ok(!/Buscando/.test(caja.innerHTML), 'y no puede quedar en "Buscando…"');
});

test('cada fila de la lista dice por qué está ahí', async () => {
  // Buscar un teléfono y ver un usuario que no se parece en nada obliga a adivinar si matcheó
  // por teléfono, por titular, o si es basura. La fila tiene que decirlo.
  const filas = [
    { usuario: 'pruebaxx',    telefono: '1134970581', titular: null,  motivo: 'exacto',   total: 4 },
    { usuario: 'vaporprueba', telefono: '1123568990', titular: null,  motivo: 'usuario',  total: 4 },
    { usuario: 'noex90',      telefono: '1123569887', titular: null,  motivo: 'telefono', total: 4 },
    { usuario: 'flowerr',     telefono: '1133826956', titular: 'Pepe', motivo: 'titular', total: 4 }
  ];
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: filas, error: null }) });

  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  sb._crmBusq.q = 'prueba';
  await sb.crmBuscarServidor();

  assert.match(caja.innerHTML, /🎯 exacto/);
  assert.match(caja.innerHTML, /👤 usuario/);
  assert.match(caja.innerHTML, /📱 teléfono/);
  assert.match(caja.innerHTML, /🧾 titular/);
  assert.match(caja.innerHTML, /Coinciden con/, 'y la lista dice qué está mostrando');
});

test('sin búsqueda el motivo dice qué hacer, no cómo se encontró', async () => {
  // "exacto / usuario / teléfono" es la mecánica de la búsqueda: sin buscar no explica nada.
  // Lo que hay que decir es por qué mirar a ese jugador antes que a otro.
  const filas = [
    { usuario: 'juandiaz730', motivo: 'esperando',  total: 13759 },
    { usuario: 'mari4198x',   motivo: 'sin_operar', total: 13759 },
    { usuario: 'leami20',     motivo: 'alta_nueva', total: 13759 },
    { usuario: 'francoiba3',  motivo: 'registrado', total: 13759 }
  ];
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: filas, error: null }) });
  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'crmResultados' ? caja : null);

  sb._crmBusq.q = '';
  await sb.crmBuscarServidor();

  assert.match(caja.innerHTML, /🔴 esperando/, 'el que tiene una solicitud abierta va primero');
  assert.match(caja.innerHTML, /🔁 nunca operó/);
  assert.match(caja.innerHTML, /🆕 alta nueva/);
  assert.match(caja.innerHTML, /primero los que esperan/, 'la lista dice con qué criterio ordenó');
  assert.match(caja.innerHTML, /de <b>13\.759<\/b>/, 'y cuántos hay detrás');
  assert.match(caja.innerHTML, /Siguiente/, 'con páginas: sin ellas verías siempre los mismos');
});

test('las páginas no se pasan de la última ni van antes de la primera', () => {
  const sb = arrancarPanel();
  sb.crmBuscarServidor = () => {};
  sb._crmBusq.total = 60; sb._crmBusq.cantidad = 25;   // 3 páginas: 0, 1, 2

  sb._crmBusq.pagina = 0; sb.crmBusqPagina(-1);
  assert.equal(sb._crmBusq.pagina, 0);
  sb._crmBusq.pagina = 2; sb.crmBusqPagina(1);
  assert.equal(sb._crmBusq.pagina, 2);
  sb._crmBusq.pagina = 1; sb.crmBusqPagina(1);
  assert.equal(sb._crmBusq.pagina, 2);

  // Cambiar la cantidad vuelve al principio: la página vieja ya no significa lo mismo.
  sb._crmBusq.pagina = 2; sb.crmBusqCantidad('50');
  assert.equal(sb._crmBusq.pagina, 0);
});

test('la página pedida se traduce a offset, no se filtra en el navegador', async () => {
  let visto = null;
  const sb = arrancarPanel({
    rpc: (_fn, args) => { visto = args; return Promise.resolve({ data: [], error: null }); }
  });
  sb.document.getElementById = () => ({ innerHTML: '' });

  sb._crmBusq.cantidad = 25;
  sb._crmBusq.pagina = 3;
  await sb.crmBuscarServidor();

  assert.equal(visto.p_limit, 25);
  assert.equal(visto.p_offset, 75, 'página 3 de a 25 arranca en la 75');
});
