# Fuente del panel operativo

Editar acá, no en `NODO · OPERATIVO LITE.htm`: ese archivo es la salida generada
y se conserva versionado para abrirlo y empaquetarlo como antes.

## Flujo de edición

1. Buscar la función con `rg -n "nombreFuncion" renderer`.
2. Editar el archivo encontrado; el marcado está en `panel.template.html`.
3. Ejecutar `npm run panel:build`, `npm test` y `npm run panel:smoke`.
4. Entregar fuente y HTML generado juntos. `npm run panel:check` detecta diferencias.

En PowerShell con scripts deshabilitados, usar `npm.cmd` en vez de `npm`.
El inicio, desarrollo y empaquetado por npm generan el panel automáticamente.
No hay dependencias nuevas. El ensamblador no ejecuta el código ni accede a la red.

## Mapa de lectura mínima

| Tema | Fuente |
| --- | --- |
| Marcado, formularios, botones | `panel.template.html` |
| Orden de bloques y fragmentos | `manifest.json` |
| CSS | `styles/` |
| Estado global y Supabase | `core/configuracion-y-estado.js` |
| Login, oficina y suscripciones | `core/login-y-realtime.js` |
| Cargas/retiros manuales | `core/operaciones-manuales.js` |
| Cola serial, sesión y llamadas a Agentes | `core/agentes-cola-y-sesion.js` |
| Cargas/retiros automáticos | `core/automatizaciones.js` |
| Conciliación | `core/conciliacion.js` |
| Sesión, saldos, registro y movimientos Chunior | `core/chunior-*.js` |
| Historial y lotes | `core/historial-*.js`, `core/lotes-y-solicitudes.js` |
| Jugadores, perfiles y cotejo de altas | `core/jugadores-*.js`, `core/perfil-jugador.js`, `core/cotejo-alta.js` |
| Integración Nexo | `core/nexo.js` |
| Portal: solicitudes, retiros parciales y chat | `portal/` |
| Composición del portal y dependencias explícitas | `extensions/portal-bridge.js` |
| Lógica pura sin DOM (formatos, CSV, conciliación) | `domain/` |
| Realtime y coordinación de refrescos | `runtime/` |
| Cuenta de no leídos vigente | `chat/metrics.js` |
| Chat original y overrides posteriores | `core/chat.js`, `chat/` |
| CRM posterior | `extensions/jugadores-crm.js` |
| Validación por oficina/PC | `extensions/validacion-*.js` |

## Contrato de ensamblado

`manifest.json` enumera cada bloque y sus fuentes en orden. La plantilla conserva
las etiquetas originales y marca su contenido con tokens `{{nodo:js:...}}` /
`{{nodo:css:...}}`. La concatenación no agrega separadores. Conservar un salto de
línea al final de los fragmentos para no unir comentarios.

Con `externalAssets` en el manifiesto, cada bloque se escribe en `generated/` y la
etiqueta queda apuntando ahí. Siguen siendo scripts clásicos y bloqueantes, en el
mismo orden y con los mismos ids: el navegador los ejecuta como si estuvieran inline.
No agregar `defer` ni `type="module"`. Los generados no se editan a mano.

Los 32 archivos de `core/` forman **un mismo script clásico**. Conservan variables
léxicas compartidas, funciones elevadas (hoisting), llamadas de arranque y handlers
HTML. Los demás bloques mantienen su forma original, varios con IIFE.
Los overrides se aplican en su orden original: no ordenar alfabéticamente, agregar
`defer`, envolver `core/` en funciones ni convertir a ES modules sin migrar contratos.

Es una separación de fuentes por responsabilidad, todavía con acoplamiento global.
`portal/`, `domain/`, `runtime/` y `chat/metrics.js` ya reciben dependencias
explícitas; `core/` y los overrides de `chat/` todavía no.
Para desacoplar una función: identificar lecturas/escrituras externas, introducir
dependencias explícitas, probar su contrato y recién entonces cambiar sus consumidores.

La sintaxis se valida por bloque completo. Las pruebas verifican el ensamblador, el
alcance/orden con un ejemplo aislado y los módulos con dependencias explícitas.
`npm run panel:smoke` arranca el panel en Chromium headless, con Supabase falso y la
red externa bloqueada. Nada de esto simula Electron, sesión de Agentes ni RPC reales.
El estado general y el siguiente trabajo están en `../MODULARIZACION.md`.
