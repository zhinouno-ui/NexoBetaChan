// Arranque real en Chromium, con datos falsos y toda la red externa bloqueada.
// Uso: node scripts/smoke-panel.cjs [ruta-al-chrome-o-edge]
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { build } = require('./build-panel.cjs');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const browserPath = process.argv[2] || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find(file => fs.existsSync(file));
  if(!browserPath) throw Error('Indicá la ruta de Chromium/Chrome/Edge para el smoke test.');
  const panel = build({ check: true });
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nodo-smoke-'));
  const failures = [], missing = [], blocked = [];
  let browser, socket;
  const stub = `window.supabase = { createClient(){
    const result = () => Promise.resolve({ data: [], error: null });
    const query = new Proxy({}, {get(_, key){ return key === 'then' ? result().then.bind(result()) : () => query; }});
    const channel = { on(){ return channel; }, subscribe(){ return channel; } };
    return { from(){ return query; }, rpc: result, channel(){ return channel; }, removeChannel: result };
  }};`;
  const server = http.createServer((req, res) => {
    const resource = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(resource === '/node_modules/@supabase/supabase-js/dist/umd/supabase.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(stub); return;
    }
    if(resource === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(panel.html); return; }
    if(!/^\/(renderer\/generated\/[^/]+\.(?:js|css)|icons\/[^/]+\.(?:png|ico))$/.test(resource)) {
      res.writeHead(404); res.end(); return;
    }
    const file = path.join(root, resource.slice(1));
    if(!fs.existsSync(file)) { missing.push(resource); res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', resource.endsWith('.js') ? 'text/javascript; charset=utf-8' : resource.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/png');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
      '--remote-debugging-port=0', '--remote-allow-origins=*', '--user-data-dir=' + profile, 'about:blank'],
    { windowsHide: true, stdio: 'ignore' });
    browser.on('error', error => failures.push(error.message));
    const endpointFile = path.join(profile, 'DevToolsActivePort');
    for(let i = 0; i < 100 && !fs.existsSync(endpointFile); i++) await pause(100);
    if(!fs.existsSync(endpointFile)) throw Error('Chromium no inició DevTools.');
    const port = fs.readFileSync(endpointFile, 'utf8').split('\n')[0];
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let seq = 0;
    const pending = new Map();
    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
      });
    }
    socket.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if(msg.id) {
        const call = pending.get(msg.id); if(!call) return;
        pending.delete(msg.id); clearTimeout(call.timer);
        if(msg.error) call.reject(Error(msg.error.message)); else call.resolve(msg.result);
      } else if(msg.method === 'Runtime.exceptionThrown') {
        failures.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      } else if(msg.method === 'Fetch.requestPaused') {
        const { requestId, request } = msg.params;
        if(request.url.startsWith(origin + '/')) send('Fetch.continueRequest', { requestId }).catch(error => failures.push(error.message));
        else {
          blocked.push(new URL(request.url).origin);
          send('Fetch.fulfillRequest', { requestId, responseCode: 503, body: '' }).catch(error => failures.push(error.message));
        }
      }
    });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Page.navigate', { url: origin + '/' });
    await pause(3000);
    const check = await send('Runtime.evaluate', { returnByValue: true, expression: `({
      ready: document.readyState,
      login: !!document.getElementById('loginUsuario') && !!document.getElementById('loginClave'),
      portal: !!window.V154P && window.V154P.portalBridgeReady,
      contracts: ['login','ejecutarOperacionManual','cargarSolicitudesPortal','abrirModalPortalSolicitud',
        'confirmarPortalJobModal','abrirModalRetiroV2','cerrarRetiroV2','cargarChats','renderChatListStep2']
        .filter(name => typeof window[name] !== 'function'),
      assets: [...document.scripts].filter(script => script.src.includes('/renderer/generated/')).length
    })` });
    const state = check.result.value;
    assert.equal(state.ready, 'complete'); assert.equal(state.login, true); assert.equal(state.portal, true);
    assert.deepEqual(state.contracts, [], 'Faltan contratos del panel');
    assert.deepEqual(failures, [], 'Errores de JavaScript en Chromium');
    assert.deepEqual(missing, [], 'Recursos locales faltantes');
    console.log(JSON.stringify({ ok: true, ...state, blockedExternalOrigins: [...new Set(blocked)] }, null, 2));
    await send('Browser.close').catch(() => {});
  } finally {
    socket?.close();
    browser?.kill();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await pause(500);
    assert.equal(path.dirname(profile), path.resolve(os.tmpdir()));
    assert.ok(path.basename(profile).startsWith('nodo-smoke-'));
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch(_) { console.warn('Perfil temporal todavía ocupado:', profile); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
