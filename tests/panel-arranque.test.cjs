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
    // localStorage DE VERDAD, en memoria. Con uno que no guardaba nada, todo lo que usa caché
    // local -- titulares bloqueados, la ruta del portal, el período del historial -- parecía
    // roto en los tests aunque anduviera.
    localStorage: (() => {
      const m = new Map();
      return {
        getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
        setItem: (k, v) => { m.set(String(k), String(v)); },
        removeItem: (k) => { m.delete(String(k)); },
        clear: () => m.clear()
      };
    })(),
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
  // Cliente falso ENCADENABLE. Con uno que devolvia {} en .from(), cualquier cosa que corriera
  // despues del test -- por ejemplo cargarSolicitudesPortal, que actualizarSolicitudPortal
  // dispara al terminar -- explotaba con "Cannot read properties of null" y ensuciaba la corrida.
  const cadena = () => {
    const q = { then: (r) => Promise.resolve({ data: [], error: null }).then(r) };
    for (const m of ['select','insert','update','delete','upsert','eq','neq','in','is','gte','lte','gt','lt','like','ilike','or','order','limit','range','single','maybeSingle','not','filter','contains']) {
      q[m] = () => q;
    }
    return q;
  };
  sb.supabase = { createClient: () => ({
    rpc: (opciones && opciones.rpc) || (async () => ({ data: null, error: null })),
    from: cadena,
    channel: () => ({ on: () => ({ subscribe: noop }) }),
    removeChannel: noop
  }) };
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
  assert.match(modal.cuerpo, /Refrescar la clave a 12345a/, 'el camino real es refrescarla y pasarla');
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

test('la ficha de ingreso ya no ofrece WhatsApp, y el botón azul dice qué hace', async () => {
  // WhatsApp Web no carga adentro de Electron: window.open abría otra ventana de Electron y la
  // página quedaba colgada. Y el botón azul del modal salía mudo y muerto: (null, '').
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [{ usuario: 'lmaurod', telefono: '3517352547', clave: '12345a' }], error: null }) });
  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo, saveFn, saveText) => { modal = { titulo, cuerpo, saveFn, saveText }; };
  await sb.pjDatosIngreso('lmaurod');

  assert.equal(typeof sb.pjIngresoWhatsapp, 'undefined', 'la función se borró');
  assert.ok(!/WhatsApp/i.test(modal.cuerpo), 'y no queda el botón');
  assert.equal(modal.saveText, '📋 Copiar datos');
  assert.equal(typeof modal.saveFn, 'function', 'el botón azul ahora copia');
});

test('la clave que se pasa es siempre la estándar de la operación', async () => {
  const sb = arrancarPanel({ rpc: () => Promise.resolve({ data: [{ usuario: 'lmaurod', telefono: '3517352547', clave: 'otracosa9' }], error: null }) });
  sb.toast = () => {};
  sb.abrirModal = () => {};
  await sb.pjDatosIngreso('lmaurod');
  assert.equal(sb.CLAVE_ESTANDAR, '12345a');
  assert.match(sb._pjTextoIngreso, /Clave: otracosa9/, 'se muestra la real, no una inventada');
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

test('"Ya se la cargué" cierra como acreditada, no como rechazo', async () => {
  // Medido: 124 rechazos en 30 días con el motivo escrito a mano — "CARGADO", "YA FUE CARGADO",
  // "FICHAS CARGADAS", "YA SE TE CARGO"… Seis redacciones de lo mismo. El operador ya le cargó y
  // usa Rechazar para sacarla de la bandeja; el jugador ve "Rechazada" con la plata adentro.
  const sb = arrancarPanel();
  assert.equal(typeof sb.v154pYaCargada, 'function', 'el bridge tiene que exponerla');

  // Las funciones del portal quedan atadas a `deps` al montarse, así que el punto donde se puede
  // interceptar es la RPC — que además es lo que de verdad llega a la base.
  const llamadas = [];
  sb.panelAPI = { rpc: async (fn, params) => { llamadas.push({ fn, params }); return { data: {}, error: null }; } };
  sb.toast = () => {};
  sb.cerrarModal = () => {};
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx', MONTO_REAL: 20000 }] };

  let confirmar = null;
  sb.abrirModal = (_t, _b, fn) => { confirmar = fn; };
  sb.v154pYaCargada('191800');
  assert.equal(typeof confirmar, 'function', 'tiene que abrir el modal');
  await confirmar();

  const upd = llamadas.find((c) => c.fn === 'panel_v15_5_actualizar_solicitud_portal');
  assert.ok(upd, 'tiene que cerrar la solicitud');
  assert.equal(upd.params.p_estado, 'ACREDITADA', 'acreditada, NO rechazada');
  assert.equal(upd.params.p_metadata.cerrada_como, 'YA_CARGADA');
  assert.equal(upd.params.p_metadata.etapa, 'YA_CARGADA_MANUAL');
  assert.equal(upd.params.p_id, 191800);

});

test('el atajo "Ya se la cargué" está adentro del modal de rechazo', () => {
  // Es donde el operador está parado cuando se da cuenta de que en realidad ya se la cargó.
  const sb = arrancarPanel();
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx' }] };

  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.v154pRechazarSolicitud('191800');

  assert.match(cuerpo, /Ya se la cargué/, 'el atajo tiene que estar a mano');
  assert.match(cuerpo, /v154pYaCargada\('191800'\)/);
  assert.match(cuerpo, /Motivo/, 'y el rechazo normal sigue estando');
});

test('la diferencia de fichas se explica, y el botón sale sólo cuando hay', () => {
  // "-$ 3.462" solo no dice nada: ni si hay que hacer algo, ni de dónde salió. Y un botón que
  // está siempre se vuelve decorado y nadie lo toca el día que hace falta.
  const sb = arrancarPanel();
  assert.equal(typeof sb.explicarDiferenciaFichas, 'function');

  const btn = { style: { display: 'none' } };
  const celdas = {};
  for (const id of ['statFichasCard', 'statDrexFichas', 'statChuniorFichas', 'statDiffFichas', 'statFichasEstado']) {
    celdas[id] = { textContent: '', classList: { add: () => {}, remove: () => {} } };
  }
  sb.document.getElementById = (id) => (id === 'btnInfoDife' ? btn : (celdas[id] || null));

  // Cuadrado: el botón no va.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 100000;', sb);
  sb.renderFichasInicio();
  assert.equal(btn.style.display, 'none', 'sin diferencia no hay nada que explicar');

  // Con dife: aparece.
  vm.runInContext('_watchdog.drexFichas = 103462; _watchdog.chuniorFichas = 100000;', sb);
  sb.renderFichasInicio();
  assert.notEqual(btn.style.display, 'none', 'con diferencia tiene que ofrecerse');
});

test('el cuadro de la dife dice para qué lado y qué hacer', () => {
  const sb = arrancarPanel();
  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.document.getElementById = () => null;

  // Sobran fichas en el casino: se cargó algo que no quedó anotado.
  vm.runInContext('_watchdog.drexFichas = 103462; _watchdog.chuniorFichas = 100000;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Sobran fichas/, 'el signo es lo que nadie tiene memorizado');
  assert.match(cuerpo, /Qué hacer, en orden/);
  assert.match(cuerpo, /Rechequear/, 'lo primero es descartar que sea transitoria');

  // Al revés.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 103462;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Faltan fichas/);

  // Cuadrado: lo dice y no manda a hacer nada.
  vm.runInContext('_watchdog.drexFichas = 100000; _watchdog.chuniorFichas = 100000;', sb);
  sb.explicarDiferenciaFichas();
  assert.match(cuerpo, /Está cuadrado/);
  assert.ok(!/Qué hacer, en orden/.test(cuerpo), 'sin dife no se le da una lista de tareas');
});

test('"Ya cargada" no está en la tarjeta del Inicio, sólo en el rechazo', () => {
  // La tarjeta ya tiene Tomar / Aprobar / Ver / Rechazar. "Ya cargada" es un caso raro
  // (124 en 30 días) y no merece un lugar fijo ahí: vive donde el operador se da cuenta.
  const fuente = fs.readFileSync(path.join(RAIZ, 'renderer', 'portal', 'requests-view.js'), 'utf8');
  assert.ok(!/onclick="v154pYaCargada/.test(fuente), 'no va en la bandeja del Inicio');

  const sb = arrancarPanel();
  sb.V154P = { solicitudes: [{ ID: '191800', USUARIO: 'pruebaxx' }] };
  let cuerpo = '';
  sb.abrirModal = (_t, b) => { cuerpo = b; };
  sb.v154pRechazarSolicitud('191800');
  assert.match(cuerpo, /Ya se la cargué/, 'pero sí adentro del rechazo');
});

test('bloquear un titular ahora va a la base, no sólo al localStorage de la PC', async () => {
  // El bloqueo vivía en el localStorage de UNA máquina: el portal no se enteraba nunca y le
  // seguía ofreciendo al jugador el titular que le acababan de bloquear; otro operador en otra
  // PC tampoco lo veía; y limpiar los datos del navegador lo borraba.
  const llamadas = [];
  const sb = arrancarPanel({ rpc: async (fn, params) => { llamadas.push({ fn, params }); return { data: {}, error: null }; } });
  sb.toast = () => {};
  vm.runInContext('pcOperativa = "P1";', sb);

  sb.marcarTitularRechazado('pruebaxx', 'pepep eeedcf', 'BLOQUEADO_POR_OPERADOR');
  const bloq = llamadas.find((c) => c.fn === 'panel_titular_bloquear');
  assert.ok(bloq, 'tiene que escribir en la base');
  assert.equal(bloq.params.p_usuario, 'pruebaxx');
  assert.equal(bloq.params.p_titular, 'pepep eeedcf');
  assert.equal(bloq.params.p_pc, 'P1');

  // Y el caché local sigue, para que la pantalla reaccione sin esperar la red.
  assert.ok(sb.titularBloqueado('pruebaxx', 'pepep eeedcf'), 'el local es el caché rápido');

  sb.desmarcarTitularRechazado('pruebaxx', 'pepep eeedcf');
  assert.ok(llamadas.find((c) => c.fn === 'panel_titular_desbloquear'), 'desbloquear también');
  assert.equal(sb.titularBloqueado('pruebaxx', 'pepep eeedcf'), null);
});

test('el panel trae al arrancar los titulares que bloqueó otra PC', async () => {
  const sb = arrancarPanel({
    rpc: async (fn) => (fn === 'panel_titulares_bloqueados'
      ? { data: [{ usuario: 'otrojugador', titular: 'Juan Perez', motivo: 'x', created_at: '2026-09-09T10:00:00Z' }], error: null }
      : { data: {}, error: null })
  });
  vm.runInContext('pcOperativa = "P1";', sb);

  assert.equal(sb.titularBloqueado('otrojugador', 'Juan Perez'), null, 'todavía no lo conoce');
  await sb.sincronizarTitularesBloqueados();
  assert.ok(sb.titularBloqueado('otrojugador', 'Juan Perez'), 'después de sincronizar, sí');
});

test('un turno es un bloque de un día, no una franja horaria de todos', () => {
  // El KPI decía "15 cargas aprobadas en el turno" mientras la lista mostraba una carga por DÍA.
  // Causa: se comparaba sólo la hora, así que "TM" incluía las 07:30 de hoy, de ayer y de la
  // semana pasada.
  const sb = arrancarPanel();
  const enTurno = vm.runInContext('_enTurno', sb);
  const bordes = vm.runInContext('_bordesTurno', sb);

  // Hora argentina = UTC−3. Las 10:00 AR de hoy son las 13:00 UTC.
  const hoyAR = (h, m) => {
    const ahora = new Date(Date.now() - 3 * 3600 * 1000);
    return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), h, m || 0) + 3 * 3600 * 1000);
  };

  const b = bordes('TM');
  assert.ok(b && b.hasta - b.desde === 8 * 3600 * 1000, 'un turno dura 8 h');

  // Mismo horario, otro día: NO es del turno.
  const ayerMismaHora = new Date(hoyAR(7, 30).getTime() - 24 * 3600 * 1000);
  assert.equal(enTurno(ayerMismaHora.toISOString(), 'TM'), false, 'las 07:30 de ayer no son de este turno');

  // Fuera de la franja tampoco.
  assert.equal(enTurno(hoyAR(15, 0).toISOString(), 'TM'), false, 'las 15:00 no son TM');

  // Sin fecha no se cuenta: antes entraba siempre y engordaba el KPI.
  assert.equal(enTurno(null, 'TM'), false);
  assert.equal(enTurno('', 'TM'), false);

  // Un turno inexistente no rompe.
  assert.equal(enTurno(new Date().toISOString(), 'XX'), false);
});

test('el turno noche cruza la medianoche y no se parte en dos', () => {
  const sb = arrancarPanel();
  const bordes = vm.runInContext('_bordesTurno', sb);
  const b = bordes('TN');
  assert.ok(b, 'TN tiene bordes');
  assert.equal(b.hasta - b.desde, 8 * 3600 * 1000, 'de 22:00 a 06:00 son 8 h');

  // Arranca a las 22:00 hora argentina, sea de hoy o de ayer según cuándo se pregunte.
  const inicioAR = new Date(b.desde - 3 * 3600 * 1000);
  assert.equal(inicioAR.getUTCHours(), 22, 'el turno noche empieza a las 22:00 AR');
});

test('getBilleraLanding nunca devuelve una billetera de otra oficina', () => {
  // Caso real: en P4 devolvía AVILA MP, que es de P2, porque `billeteras` venía contaminado y
  // el .find() agarraba la primera SELECCIONADA_MANUAL de cualquier oficina. No es cosmético:
  // esta función decide a qué billetera se le ajusta el saldo después de una carga.
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "P4";', sb);
  vm.runInContext(
    'billeteras.push(' +
    '{ID_BILLETERA:"b-avila",NOMBRE_VISIBLE:"AVILA MP",PC:"P2",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"},' +
    '{ID_BILLETERA:"b-gio",NOMBRE_VISIBLE:"GIORDANO",PC:"P4",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);

  const b = sb.getBilleraLanding();
  assert.ok(b, 'tiene que devolver una');
  assert.equal(b.NOMBRE_VISIBLE, 'GIORDANO', 'la de ESTA oficina, aunque la ajena esté primera');
  assert.equal(b.PC, 'P4');
});

test('sin oficina resuelta getBilleraLanding no filtra de más', () => {
  // Al arrancar, pcOperativa puede estar vacío. Filtrar ahí dejaría al panel sin billeteras.
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "";', sb);
  vm.runInContext('billeteras.push({ID_BILLETERA:"b1",NOMBRE_VISIBLE:"UNA",PC:"P4",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);
  assert.ok(sb.getBilleraLanding(), 'sin oficina resuelta se devuelve igual');
});

test('una billetera sin oficina cargada no se descarta', () => {
  const sb = arrancarPanel();
  vm.runInContext('pcOperativa = "P4";', sb);
  vm.runInContext('billeteras.push({ID_BILLETERA:"b1",NOMBRE_VISIBLE:"SIN PC",PC:"",ACTIVA:"SI",SELECCIONADA_MANUAL:"SI"});', sb);
  assert.ok(sb.getBilleraLanding(), 'sin PC en la fila no se puede afirmar que sea ajena');
});

// ══════════════════════════════════════════════════════════════════════════════
// EL CIRCUITO DEL RETIRO PARCIAL, de punta a punta
// 32 cierres manuales en las 7 oficinas quedaron SIN motivo guardado. Que el código fuente
// se vea bien no alcanza: estas pruebas ejercitan el circuito sobre el bundle que corre.
// ══════════════════════════════════════════════════════════════════════════════

// Una solicitud de retiro a medio pagar, con el progreso ya registrado por la RPC.
function _solParcial(pagado){
  return {
    ID: 4242, TIPO: 'RETIRO', ESTADO: 'EN_PROCESO',
    USUARIO: 'demoparcial', TITULAR: 'Demo Parcial', MONTO: 2000000,
    METADATA: { retiro_parcial: {
      total: 2000000, pagado: pagado,
      pagos: [{ monto: pagado, fecha: '2026-09-01T10:00:00Z', operador: 'op1' }]
    } }
  };
}

// getElementById de mentira: devuelve lo que se le pida por id, y algo inofensivo para el resto.
function _domCon(campos){
  return function(id){
    if(Object.prototype.hasOwnProperty.call(campos, id)) return campos[id];
    return { style:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){ return false; } },
             value:'', textContent:'', innerHTML:'', appendChild(){}, remove(){},
             setAttribute(){}, getAttribute(){ return null; },
             querySelector(){ return null; }, querySelectorAll(){ return []; },
             scrollIntoView(){}, focus(){} };
  };
}

test('parcial · el motivo y la nota llegan, y no pisan lo ya pagado', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb.registrarEnHistorial = async () => ({});
  sb.cargarSolicitudesPortal = async () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];

  let modal = null;
  sb.abrirModal = (titulo, cuerpo, saveFn, saveText) => { modal = { titulo, cuerpo, saveFn, saveText }; };
  sb.document.getElementById = _domCon({
    cierreParcialMotivo: { value: 'SE_LO_JUGO' },
    cierreParcialNota:   { value: 'Se jugó el resto del saldo antes de terminar de cobrar.' }
  });

  let enviado = null;
  sb.actualizarSolicitudPortal = async (id, estado, extra) => { enviado = { id, estado, extra }; return { error: null }; };

  sb.cerrarRetiroSaldado(4242);
  assert.equal(typeof modal.saveFn, 'function', 'el modal de cierre tiene que pedir el motivo');
  await modal.saveFn();

  assert.ok(enviado, 'el cierre tiene que llegar al servidor');
  assert.equal(enviado.estado, 'PAGADA');
  assert.equal(enviado.extra.cierre_motivo, 'SE_LO_JUGO', 'el motivo viaja');
  assert.match(enviado.extra.cierre_nota, /se jugó el resto/i, 'la nota viaja');
  assert.equal(enviado.extra.etapa, 'RETIRO_CIERRE_MANUAL');

  // Lo que más importa: la RPC hace merge SHALLOW, así que si el panel manda retiro_parcial
  // sin lo que ya había, BORRA el progreso. Tiene que venir completo.
  const rp = enviado.extra.retiro_parcial;
  assert.equal(rp.total, 2000000, 'el total ya registrado se conserva');
  assert.equal(rp.pagado, 500000, 'lo ya pagado se conserva');
  assert.equal(rp.pagos.length, 1, 'los pagos anteriores se conservan');
  assert.equal(rp.cierre.motivo, 'SE_LO_JUGO');
  assert.equal(rp.cierre.faltante, 1500000, 'queda asentado cuánto quedó sin pagar');
});

test('parcial · sin explicar qué pasó, no se cierra', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];

  let modal = null;
  sb.abrirModal = (t, c, saveFn) => { modal = { saveFn }; };
  sb.document.getElementById = _domCon({
    cierreParcialMotivo: { value: 'OTRO' },
    cierreParcialNota:   { value: 'nada' }   // menos de 8 caracteres
  });
  let llamado = false;
  sb.actualizarSolicitudPortal = async () => { llamado = true; return { error: null }; };

  sb.cerrarRetiroSaldado(4242);
  await modal.saveFn();
  assert.equal(llamado, false, 'sin nota no se cierra: es el único registro de por qué quedó a medias');
});

test('parcial · se va a su caja, y la solicitud común se queda en la lista', () => {
  const sb = arrancarPanel();
  const caja = { innerHTML: '' };
  sb.document.getElementById = _domCon({ tablaSolicitudesInicio: caja });

  const carga = { ID: 7, TIPO: 'CARGA', ESTADO: 'PENDIENTE', USUARIO: 'otro', MONTO: 5000, METADATA: {} };
  sb.V154P.solicitudes = [_solParcial(500000), carga];

  sb.v154pRenderSolicitudesPortalEnInicio();

  assert.equal(sb._parcialesEnProceso.length, 1, 'el parcial sale de la lista principal');
  assert.equal(String(sb._parcialesEnProceso[0].ID), '4242');
  assert.match(caja.innerHTML, /otro/, 'y la carga pendiente sigue a la vista');
  assert.ok(!/demoparcial/.test(caja.innerHTML), 'el parcial ya no tapa la lista');
});

test('parcial · la caja lo dibuja con su progreso', () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  sb._parcialesEnProceso = [_solParcial(500000)];
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };

  sb.verRetirosParciales();

  assert.match(modal.titulo, /Retiros pagándose por partes/);
  assert.match(modal.cuerpo, /demoparcial/, 'se ve de quién es');
  assert.match(modal.cuerpo, new RegExp('falta\\s*' + sb.money(1500000).replace(/[$.]/g, '\\$&')), 'y cuánto falta');
  assert.match(modal.cuerpo, /width:25%/, 'la barra dibuja el 25% pagado');
});

test('parcial · el progreso avanza a medida que se paga', () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  const dibujar = function(pagado){
    sb._parcialesEnProceso = [_solParcial(pagado)];
    let cuerpo = '';
    sb.abrirModal = (t, c) => { cuerpo = c; };
    sb.verRetirosParciales();
    return cuerpo;
  };

  const alInicio = dibujar(500000);
  const aMitad   = dibujar(1500000);
  const alFinal  = dibujar(2000000);

  assert.match(alInicio, /width:25%/);
  assert.match(aMitad,   /width:75%/, 'el progreso se mueve con cada pago');
  assert.match(alFinal,  /width:100%/);

  assert.ok(!/saldado/.test(alInicio), 'a medio pagar NO dice saldado');
  assert.match(alFinal, /saldado/, 'cuando se cubre el total, queda marcado como saldado');
  // Y el botón cambia: mientras falta plata se puede seguir pagando; saldado, solo cerrar.
  assert.match(aMitad,  /Pagar más/);
  assert.ok(!/Pagar más/.test(alFinal), 'saldado ya no ofrece pagar más');
});

// ══════════════════════════════════════════════════════════════════════════════
// LOS ARREGLOS DEL RELEVAMIENTO DEL 2026-09-11
// ══════════════════════════════════════════════════════════════════════════════

test('D-66 · el total del parcial sale del progreso, no del monto podrido de la solicitud', () => {
  const sb = arrancarPanel();

  // Caso real: una solicitud entró del portal con un cero de más (monto 65.000.000) pero el
  // motor de pagos registró el total bueno. Antes la caja tomaba el monto de la solicitud y
  // mostraba que faltaban 64 millones.
  const podrida = sb._retiroParcialInfo({
    MONTO: 65000000,
    METADATA: { retiro_parcial: { total: 650000, pagado: 600000 } }
  });
  assert.equal(podrida.total, 650000, 'manda el total que usó el motor de pagos');
  assert.equal(podrida.restante, 50000, 'y "cuánto falta" vuelve a tener sentido');

  // Sin total registrado, sigue valiendo el de la solicitud: no se pierde el caso normal.
  const sinProgreso = sb._retiroParcialInfo({
    MONTO: 300000,
    METADATA: { retiro_parcial: { pagado: 100000 } }
  });
  assert.equal(sinProgreso.total, 300000, 'de respaldo, el monto de la solicitud');
  assert.equal(sinProgreso.restante, 200000);
});

test('D-70 · abrirChat vuelve a recibir el id de la conversación', () => {
  const sb = arrancarPanel();

  // El bug: chat-local.js carga último y pisaba la implementación buena con una que NO recibía
  // id (`async function(){ renderChatListStep2(); }`), así que hacer clic en un chat no abría
  // nada. La arity es la prueba directa: la rota declaraba cero parámetros.
  assert.equal(typeof sb.abrirChat, 'function');
  assert.equal(sb.abrirChat.length, 1, 'la que quedó viva tiene que recibir el id');

  // Y llamarla sin argumentos sigue siendo válido (repinta la lista, no explota).
  assert.doesNotThrow(() => { sb.abrirChat(); });
});

test('D-64 · el botón de cerrar el retiro se apaga al primer clic', () => {
  // El candado de reentrada vive adentro del módulo y no se alcanza desde el sandbox, pero la
  // otra mitad del arreglo sí se puede verificar donde importa: en el bundle que se distribuye.
  // Si alguien saca el disabled, esto falla.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /onclick="this\.disabled=true;_rv2Finalizar\(\)"/,
    'el botón tiene que apagarse solo: sin eso, once clics fueron once registros');
  assert.ok(!/onclick="_rv2Finalizar\(\)"/.test(bundle),
    'y no puede quedar ninguna versión sin apagar');
});

// ══════════════════════════════════════════════════════════════════════════════
// COPIAR AUNQUE EL PANEL ESTE OPERANDO
// El portapapeles exige foco, y mientras el panel opera enfoca la ventana del backoffice.
// El respaldo del enlace de acceso era prompt(), que en Electron no existe: el operador se
// quedaba sin el enlace y sin aviso.
// ══════════════════════════════════════════════════════════════════════════════

test('copiar · si no se puede copiar, el texto NO se pierde: queda a la vista', async () => {
  const sb = arrancarPanel();
  sb.toast = () => {};
  let modal = null;
  sb.abrirModal = (titulo, cuerpo) => { modal = { titulo, cuerpo }; };

  // El sandbox no tiene ni clipboard.writeText ni execCommand: es el peor caso, el mismo que
  // se da cuando la ventana del backoffice se quedó con el foco.
  const copio = await sb.nodoCopiar('https://portal.example/?t=abc123xyz', { etiqueta: 'Enlace copiado' });

  assert.equal(copio, false, 'no puede decir que copió si no copió');
  assert.ok(modal, 'tiene que mostrar el texto en vez de tragárselo');
  assert.match(modal.cuerpo, /abc123xyz/, 'y el enlace tiene que estar completo ahí');
});

test('copiar · cuando sí copia, avisa con la etiqueta que le pasaron', async () => {
  const sb = arrancarPanel();
  let dicho = '';
  sb.toast = (m) => { dicho = m; };
  sb.abrirModal = () => { throw new Error('no debería abrir el modal si copió bien'); };
  sb.navigator = { clipboard: { writeText: async () => {} } };

  const copio = await sb.nodoCopiar('hola', { etiqueta: 'Enlace copiado' });

  assert.equal(copio, true);
  assert.equal(dicho, 'Enlace copiado');
});

test('copiar · sin texto no inventa nada', async () => {
  const sb = arrancarPanel();
  let dicho = '';
  sb.toast = (m) => { dicho = m; };
  assert.equal(await sb.nodoCopiar(''), false);
  assert.match(dicho, /nada para copiar/i);
});

test('copiar · el enlace de acceso ya no depende de prompt()', () => {
  // prompt() no existe en Electron (está dicho en conciliacion.js:697). Era el ÚNICO respaldo
  // del botón del enlace: si el portapapeles fallaba, no pasaba absolutamente nada.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-jugadores-crm.js'), 'utf8');
  assert.ok(!/prompt\(/.test(bundle), 'no puede quedar un prompt() como respaldo');
  assert.match(bundle, /nodoCopiar\(msg/, 'usa el camino que recupera el foco y no pierde el texto');
});

// ══════════════════════════════════════════════════════════════════════════════
// COSAS QUE SE MUEVEN SOLAS
// Todo lo de acá abajo es lo mismo: algo aparece o crece DESPUÉS de que el operador ya decidió
// dónde iba a hacer clic, y le corre el botón de abajo del cursor. O peor: le muestra el proceso
// de otra solicitud encima de la que está completando.
// ══════════════════════════════════════════════════════════════════════════════

test('tarjeta · al encolarse cambia cómo se presenta y no vuelve a ofrecer "Aprobar"', () => {
  const sb = arrancarPanel();
  const caja = { innerHTML: '' };
  sb.document.getElementById = (id) => (id === 'tablaSolicitudesInicio' ? caja : null);
  sb.V154P.solicitudes = [{ ID: 900001, USUARIO: 'jugadordeprueba', TIPO: 'CARGA',
    ESTADO: 'PENDIENTE', MONTO_REAL: 2000, FECHA_CREACION: '2026-09-11T11:59:00Z' }];

  sb._colaCargaEstado = {};
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();
  assert.match(caja.innerHTML, /id="v154pCard900001"/,
    'la tarjeta lleva id: así la cola sabe que esta solicitud YA está a la vista y no la repite');
  assert.match(caja.innerHTML, />Aprobar</, 'sin encolar, se puede aprobar');

  // Misma solicitud, ahora en la cola.
  sb._colaCargaEstado = { '900001': { estado: 'espera', pos: 1, cid: 'cc1' } };
  sb.V154P.solicitudesLastHtml = null;
  sb.v154pRenderSolicitudesPortalEnInicio();
  assert.ok(!/>Aprobar</.test(caja.innerHTML),
    'ya encolada NO se puede aprobar de nuevo: eso era el doble clic sobre la misma carga');
  assert.match(caja.innerHTML, /en la cola/, 'y la tarjeta dice en qué estado está');
  assert.match(caja.innerHTML, /Sacar de la cola/);
});

test('alta · crear usuario avisa Y SUENA si el teléfono ya tiene dueño', async () => {
  const sb = arrancarPanel();
  sb.pcOperativa = 'P1';
  const campos = {
    nuevoJugUsuario:  { value: 'jugadordeprueba' },
    nuevoJugTelefono: { value: '1122334455' },
    nuevoJugCotejo:   { innerHTML: '' }
  };
  sb.document.getElementById = (id) => campos[id] || null;
  // Ese número es de otro usuario: es el caso de la captura (se creaba igual, sin decir nada).
  sb.altaCotejarDatos = async () => ({
    usuario:  { exacto: null, similares: [] },
    telefono: { exacto: { usuario: 'otrojugador', telefonos: ['1122334455'], pc: 'P1' }, similares: [] }
  });
  let sono = 0;
  sb.sonido = () => { sono++; };

  await sb._altaNuevoCotejarYa();

  assert.match(campos.nuevoJugCotejo.innerHTML, /otrojugador/,
    'tiene que decir de quién es el número ANTES de crear la cuenta, no después');
  assert.equal(sono, 1, 'y tiene que sonar: un cartel debajo del campo no lo ve quien mira el teclado');

  await sb._altaNuevoCotejarYa();
  assert.equal(sono, 1, 'no vuelve a sonar por el mismo dato');
});

test('el resultado de una operación no se escribe en el modal de OTRA solicitud', () => {
  // El modal de aprobar es UNO SOLO y se reusa. Como la carga corre en segundo plano, para cuando
  // termina el operador ya abrió el de la siguiente — y ahí le aparecía "Operando en Agentes..."
  // y "carga completada" de la anterior, con el botón Aprobar apagado.
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /_esMiModal/, 'tiene que preguntarse si el modal sigue siendo el suyo');
  // OJO: el bundle tiene OTRO getElementById('portalJobResultado') que es correcto y tiene que
  // quedar — el que limpia el cuadro al ABRIR el modal. Lo que se sostiene acá es que la
  // operación, que corre en segundo plano, escriba SIEMPRE a través del guard.
  assert.match(bundle, /_pintarEn\('portalJobResultado'/,
    'la operación escribe por el camino guardado, no derecho sobre el modal que esté abierto');
});

test('la cola no dibuja una fila si la solicitud ya está a la vista en pendientes', () => {
  const bundle = fs.readFileSync(
    path.join(RAIZ, 'renderer', 'generated', 'js-portal-modules.js'), 'utf8');
  assert.match(bundle, /getElementById\('v154pCard' \+ sid\)/,
    'se fija si la tarjeta ya está en pantalla antes de repetirla arriba de la lista');
  assert.ok(!/_colaCarga\.map\(function\(it,i\)\{/.test(bundle),
    'ya no mapea la cola entera sin filtrar');
});

test('la tira de proceso vive en una esquina, no flotando en el medio', () => {
  const bundle = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-core.js'), 'utf8');
  assert.match(bundle, /position:fixed;bottom:52px;left:84px/,
    'abajo a la izquierda, donde no hay barra de desplazamiento ni panel de chat');
  assert.ok(!/cssText = 'position:fixed;bottom:14px;left:50%/.test(bundle),
    'centrada no: tapaba la tabla y se montaba a la barra de desplazamiento');
});

test('el cartel "PILOTO OPERATIVO" no se dibuja más', () => {
  const js  = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'js-piloto.js'), 'utf8');
  const css = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'css-piloto.css'), 'utf8');
  assert.ok(!/nodoPilotoBadge/.test(js),  'no se crea');
  assert.ok(!/nodoPilotoBadge/.test(css), 'ni queda su estilo colgado ocupando la esquina');
});

test('los botones del modal no se corren cuando llegan los chequeos', () => {
  const css = fs.readFileSync(path.join(RAIZ, 'renderer', 'generated', 'css-base.css'), 'utf8');
  assert.match(css, /#modalBody\{[^}]*overflow-y:auto/, 'scrollea el cuerpo…');
  assert.ok(!/\.modal\{[^}]*overflow:auto/.test(css),
    '…y no el modal entero, que es lo que empujaba los botones hacia abajo mientras se leía');
});
