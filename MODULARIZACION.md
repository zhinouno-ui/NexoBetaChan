# Modularización del panel

Estado: panel y `main.js` separados y verificados (2026-09-05). No hay una edición a medias.
Objetivo de esta entrega: separar el fuente sin alterar operaciones.

## Decisión

El HTML operativo tenía ~22.000 líneas, un bloque central de ~12.000 y 24 bloques
adicionales. Comparten variables globales y hay overrides por orden. Se separan
fuentes por responsabilidad y se reconstruye el mismo panel: conserva hoisting,
alcance léxico, etiquetas, orden y momento de ejecución. Los fragmentos de `core/`
no son módulos ES independientes todavía. No convertirlos a `import` a ciegas.

## Qué quedó hecho

1. `renderer/`: 78 fuentes en 33 bloques, plantilla y manifiesto.
2. Ensamblador sin dependencias (`scripts/build-panel.cjs`) y hooks npm de
   inicio/desarrollo/empaquetado. La generación omite la escritura si no cambió nada.
3. `main.js`: de 1250 a 74 líneas, con 17 módulos en `main/`. Los 30 canales IPC
   son el mismo conjunto que antes de la extracción, verificado uno por uno.
4. `extensions/portal-bridge.js`: de ~2.800 a 193 líneas. Es el composition root;
   pasa dependencias explícitas a los 10 módulos de `portal/`.
5. `domain/` (3) y `runtime/` (2): lógica pura, sin DOM, con pruebas propias.
6. `chat/metrics.js`: la cuenta de no leídos que hoy gana, aislada y bajo prueba.
7. 50 pruebas en verde y smoke test de arranque real en verde.

## Los scripts salieron del HTML

El HTML pasó de 1.262.416 a 33.771 bytes: los 32 bloques viven en
`renderer/generated/` y el HTML los referencia. Siguen siendo scripts clásicos y
bloqueantes, en el mismo orden y con los mismos ids: no se agregó `defer`, `type=module`
ni carga diferida. `package.json` ya empaqueta `main/**` y `renderer/generated/**`.
La referencia es relativa al HTML, que Electron abre con `loadFile` desde la raíz.

Por esto ya no aplica el SHA-256 de la migración inicial: documentaba el HTML con
todo adentro. La equivalencia hoy la sostienen el ensamblador y las pruebas.

## Verificación

```powershell
npm.cmd run panel:check   # el HTML y los generados coinciden con las fuentes
npm.cmd test              # 50 pruebas
npm.cmd run panel:smoke   # arranque real en Chromium headless
```

`panel:smoke` levanta el panel en Chromium con Supabase falso y **toda la red externa
bloqueada**. Verifica `readyState`, el login, `portalBridgeReady`, nueve funciones del
contrato, que no falte ningún recurso local y que no haya una sola excepción de JS.
No necesita `npm install`: usa el Chrome o Edge que ya está en la PC.

## Lo que sigue sin probarse

No se ejecutó Electron real, ni operaciones, ni RPC contra Supabase. El smoke test
no reemplaza eso: no hay sesión de Agentes, ni Chunior, ni proxy, ni updater.
Antes de dar por buena una versión para oficina, abrirla con `npm.cmd start`.

## Siguiente trabajo, en orden sugerido

1. `chat/`: unificar `chat-no-leidos.js` contra `chat/metrics.js`. El override que hoy
   gana es `chat-estabilidad.js`. Comparar handlers efectivos y timers antes de borrar
   nada: sacar un parche sin esto puede reactivar uno viejo.
2. Seguir sacando utilidades puras de `core/utilidades-interfaz.js` y los parsers de
   `core/jugadores-importacion.js` hacia `domain/`, con pruebas de contrato.
3. `withdrawals-execution.js` devuelve `{ uncertain:true }` cuando el registro del
   parcial queda incierto. Hoy nadie lo lee: el llamador sólo mira `ok`. Decidir si el
   panel tiene que avisar distinto en ese caso.
4. Rendimiento: relevar timers y suscripciones de login/realtime, watchdog y parches de
   chat; medir consultas y renders repetidos antes de tocar los polls.

Respetar la cola serial de Agentes/Chunior, el aislamiento por oficina y la prohibición
de reintentar automáticamente acciones monetarias inciertas. Esos contratos no se tocan
como parte de una limpieza estructural.
