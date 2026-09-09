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

test('los datos de ingreso no inventan una clave que no sabemos', async () => {
  // La clave no se puede recuperar: sólo se sabe si se la pusimos nosotros. Mandar
  // "Clave: —" es peor que no mandar nada, así que sin clave no se arma el texto ni el botón.
  const sinClave = { usuario: 'lmaurod', telefono: '3517352547', titular: 'Lmaurod', clave: null };
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [sinClave], error: null }) });

  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };
  await sb.pjDatosIngreso('lmaurod');

  assert.match(modal.cuerpo, /No sabemos cuál es/);
  assert.match(modal.cuerpo, /Cambiarle la clave ahora/, 'el camino real es cambiarla y pasarla');
  assert.ok(!/Copiar para mandar/.test(modal.cuerpo), 'sin clave no hay nada que copiar');
  assert.match(modal.cuerpo, /3517352547/, 'el teléfono sí lo sabemos');
});

test('con clave conocida arma el texto listo para mandar', async () => {
  const conClave = {
    usuario: 'lmaurod', telefono: '3517352547', clave: 'zorro77',
    clave_fecha: '2026-09-01T10:00:00Z', clave_origen: 'panel'
  };
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [conClave], error: null }) });
  sb.toast = () => {};
  sb.abrirModal = () => {};
  await sb.pjDatosIngreso('lmaurod');

  const t = sb._pjTextoIngreso;
  assert.match(t, /Usuario: lmaurod/);
  assert.match(t, /Clave: zorro77/);
  assert.match(t, /Teléfono registrado: 3517352547/);
  assert.match(t, /bet-300/, 'y adónde entrar');
});

test('el WhatsApp de ingreso le pega el 549 a un número de 10 dígitos', () => {
  const sb = arrancarPanel();
  let abierto = '';
  sb.open = (u) => { abierto = u; };
  sb._pjTextoIngreso = 'Usuario: x\nClave: y\nTeléfono registrado: 3517352547\nEntrá en: https://bet-300.pw';
  sb.pjIngresoWhatsapp('x');

  assert.match(abierto, /phone=5493517352547/, 'sin el 549 WhatsApp no lo encuentra');
  assert.match(abierto, /web\.whatsapp\.com/);
});

test('actualizarSolicitudSupabase escribe donde viven las solicitudes de verdad', async () => {
  // Escribía en la tabla `solicitudes`, muerta desde el 30 de mayo (156 filas). Las del portal
  // viven en landing_solicitudes (191.608). Los 16 llamadores hacían un update que no tocaba
  // nada y el error se iba a console.error: se cambiaba la clave, funcionaba, y la solicitud
  // quedaba PENDIENTE para siempre.
  let visto = null;
  const sb = arrancarPanel({
    rpc: (fn, args) => { visto = { fn, args }; return Promise.resolve({ data: { id: 188138 }, error: null }); }
  });

  const r = await sb.actualizarSolicitudSupabase(188138, {
    estado: 'APROBADA', operador_usuario: 'xprueba'
  });

  assert.equal(r.ok, true);
  assert.equal(visto.fn, 'panel_v15_5_actualizar_solicitud_portal', 'tiene que ir por la RPC del portal');
  assert.equal(visto.args.p_id, 188138);
  assert.equal(visto.args.p_estado, 'APROBADA');
  assert.equal(visto.args.p_operador, 'xprueba');
});

test('lo que no es estado, operador ni monto viaja como metadata', async () => {
  let visto = null;
  const sb = arrancarPanel({
    rpc: (fn, args) => { visto = args; return Promise.resolve({ data: {}, error: null }); }
  });

  await sb.actualizarSolicitudSupabase(1, {
    estado: 'RECHAZADA', operador_usuario: 'op', monto: 5000, etapa: 'AUTO_RECHAZO', motivo: 'x'
  });

  assert.equal(visto.p_monto, 5000);
  assert.deepEqual({ ...visto.p_metadata }, { etapa: 'AUTO_RECHAZO', motivo: 'x' });
  assert.ok(!('estado' in visto.p_metadata), 'el estado no se duplica en el metadata');
});

test('si la RPC falla, avisa en vez de decir que salió bien', async () => {
  const sb = arrancarPanel({
    rpc: () => Promise.resolve({ data: null, error: { message: 'SOLICITUD_NO_ENCONTRADA' } })
  });
  const r = await sb.actualizarSolicitudSupabase(999, { estado: 'APROBADA' });

  assert.equal(r.ok, false);
  assert.match(r.error, /SOLICITUD_NO_ENCONTRADA/);
});

test('una solicitud de clave ya aprobada no vuelve a entrar al ciclo', () => {
  // `estadoCerrado` vive en el módulo del portal y NO existe en el ámbito del panel, así que
  // `typeof estadoCerrado === 'function'` era siempre falso y el filtro nunca corría: el ciclo
  // le cambiaba la clave al mismo jugador cada 25 s, media hora seguida.
  const sb = arrancarPanel();

  assert.equal(typeof sb._estadoYaCerrado, 'function', 'el panel necesita su propio chequeo');
  for (const e of ['APROBADA', 'RECHAZADA', 'CANCELADA', 'ACREDITADA', 'OK', 'aprobada']) {
    assert.equal(sb._estadoYaCerrado(e), true, e + ' está cerrada');
  }
  for (const e of ['PENDIENTE', 'EN_REVISION', 'EN_PROCESO', '']) {
    assert.equal(sb._estadoYaCerrado(e), false, e + ' sigue abierta');
  }
});

test('el ciclo de clave no repite una que ya ejecutó', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};

  // Una solicitud que quedó PENDIENTE aunque ya se ejecutó: el caso de la tabla muerta.
  sb.V154P = { solicitudes: [{ ID: '188138', TIPO: 'CAMBIO_CLAVE', USUARIO: 'pruebaxx',
                               ESTADO: 'PENDIENTE', PASSWORD_NUEVO: 'abc123' }] };
  sb._clavesHechas = { '188138': Date.now() };

  let ejecuciones = 0;
  sb.ejecutarAutoClave = async () => { ejecuciones++; };
  sb.ctrlElectron = { navigateAgent: async () => {} };
  sb._clavesEnCuenta = { '188138': Date.now() - 1000 };   // ventana ya vencida

  await sb._claveAutoTick();
  assert.equal(ejecuciones, 0, 'ya se ejecutó una vez: no se toca de nuevo');
});

// ── Sonda de sesión de agentes ───────────────────────────────────────────────
function panelConSonda(extra) {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb.ctrlElectron = { openAgentWindow: async () => {}, navigateAgent: async () => {} };
  sb.refrescarTodo = async () => {};
  Object.assign(sb, extra || {});
  return sb;
}

test('la sonda no toca el agente si hace poco que se operó', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now();          // recién operado
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'operar ya prueba que la sesión vive');
});

test('pasados los 6 minutos quietos, sondea con una operación real', async () => {
  const sb = panelConSonda();
  let visto = null;
  sb.callDrex = async (m, u) => { visto = { m, u }; return { needsLogin: false }; };
  sb._drexUltimaOpOk = Date.now() - 7 * 60 * 1000;
  sb.localStorage.getItem = (k) => (k === 'nodo_sonda_usuario' ? 'usuario_de_prueba' : null);

  await sb._sondaSesionTick();
  assert.equal(visto.m, 'buscarUsuario', 'es la primera parte de toda carga: si falla, la carga fallaría');
  assert.equal(visto.u, 'usuario_de_prueba');
  assert.ok(!/cambiarClave/.test(String(visto.m)), 'no se le cambia la clave a nadie cada 6 minutos');
});

test('la sonda no se mete si el agente está ocupado', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now() - 30 * 60 * 1000;
  sb.localStorage.getItem = () => 'usuario_de_prueba';
  sb._drexGlobalBusy = true;

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'meterse en medio de una carga es peor que esperar');
});

test('con el login ya en pantalla la sonda se queda quieta', async () => {
  const sb = panelConSonda();
  let llamadas = 0;
  sb.callDrex = async () => { llamadas++; return {}; };
  sb._drexUltimaOpOk = Date.now() - 30 * 60 * 1000;
  sb._drexSinSesion = true;
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(llamadas, 0, 'ya se sabe que está caída, no hay nada que descubrir');
});

test('sonda OK refresca el panel y reinicia el reloj', async () => {
  const sb = panelConSonda();
  let refrescos = 0;
  sb.refrescarTodo = async () => { refrescos++; };
  sb.callDrex = async () => ({ needsLogin: false });
  const antes = Date.now() - 7 * 60 * 1000;
  sb._drexUltimaOpOk = antes;
  sb.localStorage.getItem = () => 'usuario_de_prueba';

  await sb._sondaSesionTick();
  assert.equal(refrescos, 1, 'después de 6 minutos quieto lo que se ve ya envejeció');
  assert.ok(sb._drexUltimaOpOk > antes, 'el reloj arranca de nuevo');
});

test('el aviso de billetera vieja también entiende la solicitud cruda del Inicio', () => {
  // _billeteraVieja sólo entendía el item del historial unificado (claves en minúscula). La
  // tarjeta del Inicio y el modal de aprobar trabajan con la solicitud CRUDA del portal
  // (MAYÚSCULAS), así que ahí —que es donde el operador decide— el aviso nunca aparecía.
  const sb = arrancarPanel();
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-banco",NOMBRE_VISIBLE:"BANCO",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-salva",NOMBRE_VISIBLE:"SALVATIERRA X",ACTIVA:"SI"});', sb);

  const cruda = { ID: 191800, TIPO: 'CARGA', ESTADO: 'PENDIENTE',
                  BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' };
  const r = sb._billeteraVieja(cruda);
  assert.ok(r, 'la solicitud cruda tiene que avisar igual que el item unificado');
  assert.equal(r.vieja, 'SALVATIERRA X');
  assert.equal(r.actual, 'BANCO');

  // Sin ID_BILLETERA (metadata viejo) compara por nombre.
  assert.ok(sb._billeteraVieja({ ID: 4, TIPO: 'CARGA', ESTADO: 'PENDIENTE',
                                 BILLETERA_NOMBRE: 'SALVATIERRA X' }));

  // Y sigue funcionando el item del historial unificado.
  assert.ok(sb._billeteraVieja({ pendiente: true, tipo: 'CARGA',
                                 billetera_nombre: 'SALVATIERRA X', billetera_id: 'b-salva', _raw: {} }));

  // Los que no corresponden.
  for (const [caso, it] of [
    ['con la activa', { ID: 1, TIPO: 'CARGA', ESTADO: 'PENDIENTE', BILLETERA_NOMBRE: 'BANCO', ID_BILLETERA: 'b-banco' }],
    ['ya acreditada', { ID: 2, TIPO: 'CARGA', ESTADO: 'ACREDITADA', BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' }],
    ['retiro', { ID: 3, TIPO: 'RETIRO', ESTADO: 'PENDIENTE', BILLETERA_NOMBRE: 'SALVATIERRA X', ID_BILLETERA: 'b-salva' }]
  ]) {
    assert.equal(sb._billeteraVieja(it), null, 'no debería avisar: ' + caso);
  }
});
