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

function arrancarPanel() {
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
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);

  // El mismo orden que declara el HTML: los módulos de dominio antes que el core.
  for (const archivo of ['js-modules.js', 'js-core.js']) {
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
