# DESCONEXIONES — registro de cosas sueltas del sistema

Bitácora de piezas que **no están conectadas entre sí** (tablas huérfanas, código
que no coincide con el servidor, datos inconsistentes). No se toca nada acá: se
anota, y después se decide en conjunto qué se arregla y en qué orden.

Convención de cada ítem: **qué está desconectado** → *evidencia* → *impacto* → *estado*.

Estados: `ABIERTO` · `EN REVISIÓN` · `RESUELTO` · `DESCARTADO (así se quiso)`

Proyecto Supabase: `NODO` (`pjvvyvfcwjoocjqvdror`).

---

## D-01 · NODO no tiene whitelist de cuentas: entra cualquier cuenta válida de Chunior

**Evidencia** — `renderer/core/login-y-realtime.js:24-80`. `login()` valida usuario/clave
contra el backoffice de Chunior (`validarLoginChunior`) y, si Chunior acepta, arma el
operador **en memoria** con `rol: "OPERADOR"` hardcodeado. No consulta ninguna tabla
de autorización. Confirmado por grep: el renderer de NODO nunca lee `operadores`.

**Impacto** — La autorización real es de Chunior, no de NODO. Cualquier persona con
credenciales de Chunior válidas entra a NODO. No hay forma de dar de baja a alguien
desde NODO ni de asignarle un rol distinto de OPERADOR.

**Estado** — ABIERTO

---

## D-02 · La tabla `operadores` es del admi, no de NODO, y los nombres no coinciden

**Evidencia** — `operadores` (21 filas, todas `activo=true`) la usa **solo** el panel web
`admi-V23-COMPLETO-con-whaticket.html` vía la RPC `panel_login`. NODO no la toca.
Los nombres de una y otra no se parecen:

| `operadores` (login del admi) | `panel_actividad` (los que realmente entran a NODO) |
|---|---|
| maia, camila, fernando, nicole, aylen, brenda, thomas, zaira, clara123, juan, lautaro, tomas, ciro, lourdes, martin, nahuel, tomy2, admi, demian, julian, xprueba | feralv, nicolealv, demalv, julianalv, ramaalv, aylench, julianch, ramach, brenda, thomas, zaira, juancarlos, aylen04, julisan, lautaroo, noeliasan, ramirosan, tomassan, faylen, fciro, flibre, flourdes, fmartin, eyfjulian, bbianca, cami, iaram, marcosm, neme, soto, biancacc, camilam, cgerman, ciara, cjony, nemesismadre, sotoc, xprueba |

Las reales llevan sufijo de oficina (`-alv`, `-ch`, `-san`, `f-`, `c-`). Solo coinciden
`brenda`, `thomas`, `zaira` y `xprueba`.

**Impacto** — `operadores` está desactualizada respecto de la operación real. Cualquier
reporte del admi que cruce por operador contra esa tabla queda incompleto.

**Estado** — ABIERTO

---

## D-03 · `panel_operadores` es una tabla huérfana

**Evidencia** — 3 filas en Supabase. `grep -rol panel_operadores` sobre todo el repo
(incluido el admi y los `.sql` de `servidor/`): **cero** referencias.

**Impacto** — Datos muertos que confunden a quien lee el esquema. Hay tres tablas de
personas (`operadores`, `panel_operadores`, `panel_actividad`) y solo dos se usan.

**Estado** — ABIERTO

---

## D-04 · `panel_resolver_puesto` no falla cerrado: inventa la oficina

**Evidencia** — `renderer/core/chunior-sesion-y-billeteras.js:189-196`. Si la RPC
`panel_resolver_puesto` tira error, el `catch` sigue de largo con
`normalizarPcCodigo(text)`, o sea el nombre del puesto de Chunior normalizado a mano.

**Impacto** — Un puesto de Chunior sin alias cargado (o un corte de red en ese
momento) no rechaza el ingreso: crea una oficina fantasma y ahí van a parar las
billeteras y las operaciones. El comentario del propio código en `normalizarPcCodigo`
ya describe este problema para el caso `PC5`/`P5`.

**Estado** — ABIERTO

---

## D-05 · `nodo_oficina_aliases` usa dos criterios distintos para `oficina_id`

**Evidencia** — 56 filas. Unas oficinas usan nombre real, otras el propio `pc_codigo`:

| pc_codigo | oficina_id | criterio |
|---|---|---|
| P1 | `XPLATA` | nombre real |
| P2 | `P2` | **el pc_codigo** |
| P3 | `CHINO` | nombre real |
| P4 | `SANCHEZPLATA` | nombre real |
| P5 | `P5` | **el pc_codigo** |
| P6 | `MOR` | nombre real |
| P7 | `CRISTIANPLATA` | nombre real |

**Impacto** — Cualquier consulta que agrupe por `oficina_id` mezcla dos espacios de
nombres. Ya se ve el síntoma en `panel_actividad`: hay filas de P5 con
`oficina_id='P5'` y otras con `oficina_id='FGENERAL'` (alias que además **no existe**
en `nodo_oficina_aliases`).

**Estado** — ABIERTO

---

## D-06 · `panel_actividad` tiene filas con `oficina_id` vacío y códigos fuera del esquema

**Evidencia** — Filas con `oficina_id=''`: `ALVOFI/ramaalv`, `FADMIN/fmartin`,
`FPC1/fciro`. Los `pc_codigo` `ALVOFI`, `FADMIN` y `FPC1` no son P1..P7 ni figuran en
`nodo_oficina_aliases`. Todas con `version='V18'`.

**Impacto** — Residuo de la época pre-P1..P7. Ensucia cualquier conteo por oficina.

**Estado** — ABIERTO

---

## D-07 · `operadores.ultimo_login` no se actualiza

**Evidencia** — De 21 filas, solo `brenda` y `admi` tienen `ultimo_login`, y las dos
con la misma fecha: `2026-05-17`. El resto en `null`.

**Impacto** — No sirve para saber quién está activo. Para eso hay que ir a
`panel_sessions` (admi) o `panel_actividad` (NODO).

**Estado** — ABIERTO

---

## D-08 · Versiones dispares de NODO en producción

**Evidencia** — En `panel_actividad` conviven `V18`, `1.1.78`, `1.1.80`, `1.1.81` y
`1.1.84` (el `package.json` local está en `1.1.84`). Al 2026-09-05, la mayoría de los
puestos sigue en `1.1.80`.

**Impacto** — El auto-update no está llegando a todos. Conviene ver por qué antes de
sacar la próxima versión.

**Estado** — ABIERTO

---

## D-09 · Falta `.env` y `config.json` en el checkout local

**Evidencia** — Solo están `.env.example` y `config.example.json`. Sin
`PANEL_DATA_SECRET`, `main/config.js:61-67` deshabilita **auto-login de agente y
proxy** (el resto del panel opera normal).

**Impacto** — Local, no de producción. Anotado para no olvidarlo al levantar el entorno.

**Estado** — ABIERTO

---

## D-10 · `package-lock.json` huérfano en la carpeta padre

**Evidencia** — `C:\Users\juan\Nodo Beta\package-lock.json`, con `"packages": {}`.
Residuo de haber corrido npm un nivel arriba del proyecto.

**Impacto** — Ninguno técnico; induce a correr `npm` en la carpeta equivocada.

**Estado** — ABIERTO

---

## D-11 · Un retiro cerrado vuelve solo a «Parciales»: bucle sin salida

**Evidencia** — Caso real, retiro **#81071** (`noex90`, P1). En `landing_solicitudes` el
estado quedó en `PAGADA` (`updated_at 2026-09-05 14:47:58`), o sea el cierre **sí se
guardó**. Pero el filtro de [requests-view.js:17](renderer/portal/requests-view.js#L17) es:

```js
const abiertas = all.filter(s => (!estadoCerrado(s.ESTADO) || window._retiroParcialSigueAbierto(s)) && ...)
```

`estadoCerrado('PAGADA')` da `true` ([data.js:74-77](renderer/portal/data.js#L74-L77)), pero el
`||` lo rescata: `_retiroParcialSigueAbierto`
([archivo-historial.js:144-152](renderer/core/archivo-historial.js#L144-L152)) devuelve `true`
porque compara `pp.pagado < pp.total - 0.5`, y `pp.pagado` sale **solo** de
`metadata.retiro_parcial.pagado` (25.000 de 50.000).

El detalle clave: esa función **ignora `saldadoPorAlguna`**, que es justamente el campo
por el que el modal imprime «✔ saldado». Las dos mitades del sistema no usan el mismo
criterio para decidir si el retiro está pago.

**Impacto** — El retiro se puede cerrar infinitas veces: cada `cargarSolicitudesPortal`
lo vuelve a meter en la caja 💸 Parciales y el contador nunca baja de 1. No hay forma
de sacarlo desde el panel.

**Estado** — ABIERTO

---

## D-12 · El progreso de un retiro se escribe en dos lugares que nunca se sincronizan

**Evidencia** — Mismo #81071. Las dos fuentes que lee `_retiroParcialInfo`
([archivo-historial.js:85-108](renderer/core/archivo-historial.js#L85-L108)):

| Fuente | Valor | Quién la escribe |
|---|---|---|
| `metadata.retiro_parcial.pagado` | `25.000` (1 pago) | solo la vía «Pagar más» / parcial |
| `metadata.monto_pagado` | `50.001` | la vía de retiro normal |

El libro real (`historial_ops`, 3 filas `OK` para `solicitud_id=81071`, todas de
`xprueba` el 7/8): `25.000` (14:16, anotada «Retiro PARCIAL») + `25.000` (14:22) +
`1` (14:27) = **50.001**. O sea `monto_pagado` es el correcto y `retiro_parcial` quedó
congelado en el primer pago: los pagos 2 y 3 salieron por el flujo normal, que escribe
`monto_pagado` y **no toca** `retiro_parcial`.

**Impacto** — Origen de D-11 y del cartel «⚠ El progreso no coincide entre los dos
registros». Todo retiro que empiece por «parcial» y termine por el flujo normal queda
en este estado. El comentario de `_retiroPagadoDelHistorial`
([archivo-historial.js:60-68](renderer/core/archivo-historial.js#L60-L68)) ya dice que
la verdad es el historial — pero `_retiroParcialInfo`, que es la que decide, no lo usa.

**Estado** — ABIERTO

---

## D-13 · `verRetirosParciales` está definida dos veces en el mismo archivo

**Evidencia** — [archivo-historial.js:115](renderer/core/archivo-historial.js#L115) y
[archivo-historial.js:155](renderer/core/archivo-historial.js#L155). La segunda pisa a la
primera. La primera versión (sin botón «Cerrar», sin aviso de discrepancia) es código
muerto: nunca se ejecuta.

**Impacto** — 40 líneas que aparentan estar activas. Quien lea la primera va a sacar
conclusiones equivocadas sobre lo que hace el botón 💸.

**Estado** — ABIERTO

---

## D-14 · `cerrarRetiroSaldado` no completa el cierre

**Evidencia** — [archivo-historial.js:200-217](renderer/core/archivo-historial.js#L200-L217)
llama a `actualizarSolicitudPortal(id,'PAGADA',…)` y nada más. En #81071 quedó
`estado='PAGADA'` pero `cerrada_at = null`, y `metadata.retiro_parcial.pagado` siguió
en 25.000.

**Impacto** — Sin `cerrada_at` no se puede auditar cuándo ni quién cerró. Y al no
corregir el progreso, se realimenta D-11.

**Estado** — ABIERTO

---

## D-15 · El 100 % de las operaciones manuales queda sin dueño

**Evidencia** — Últimos 30 días en `historial_ops`: origen `MANUAL` = 7.898 filas, y las
7.898 con `solicitud_id` NULL. Lo mismo `ADMIN` (287), `DEPO_RECLAMADO` (97) y
`MANUAL_LOCAL` (7). En 60 días son 33.715 operaciones sin solicitud (19,4 % del total).

**Impacto** — El historial del usuario se arma desde `landing_solicitudes`. Sin
`solicitud_id`, para el usuario esas cargas nunca existieron.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §2

---

## D-16 · `public_code` aparenta ser un ID de operación pero identifica la oficina

**Evidencia** — 107.110 solicitudes en 30 días tienen `metadata.public_code` y hay
**7 valores distintos**, uno por ruta de `landing_rutas_publicas`: `rt-z9p42`=P4 (28.256
solicitudes), `rt-k6d92`=P2 (25.804), `rt-m4q77`=P3, `rt-m2z3r`=P7, `rt-r5023`=P6,
`rt-x2v61`=P5, `rt-a8f31`=P1.

**Impacto** — No existe ningún identificador por operación que el usuario pueda dictar y
nosotros buscar. Es el "id falso" del que no se puede rastrear nada.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §1

---

## D-17 · La cola de anotaciones de Chunior sólo la usan 4 de 12 caminos

**Evidencia** — `chuniorPendienteAdd` se llama desde 4 lugares
([automatizaciones.js:478](renderer/core/automatizaciones.js#L478),
[operation-execution.js:318](renderer/portal/operation-execution.js#L318),
[withdrawals-execution.js:209 y :274](renderer/portal/withdrawals-execution.js#L209)).
Los otros 8 sólo tiran un toast: **operaciones manuales**
([operaciones-manuales.js:745](renderer/core/operaciones-manuales.js#L745)), retiro por
chat ([automatizaciones.js:213](renderer/core/automatizaciones.js#L213)), lotes,
reclamo de depósito y las dos re-anotaciones de `historial-operaciones.js`.

Correlato en los datos: `MANUAL` tiene 1.372 filas `OK` sin número de Chunior en 30 días
(17,4 % de las manuales); `LANDING`, que sí encola, tiene 141 sobre 84.555 (0,17 %).

**Impacto** — Cien veces más pérdida en el camino que no encola. Confirma que al fallar
una anotación no se retoma.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §3

---

## D-18 · La cola de pendientes vive en localStorage y se rinde en silencio

**Evidencia** — [chunior-verificacion-y-registro.js:117-171](renderer/core/chunior-verificacion-y-registro.js#L117-L171).
Clave `nodo_chunior_pendientes`, tope de 40 ítems, reintento cada 45 s. Se rinde a los 8
intentos sin avisar, corta con `break` al primer fallo, y no corre si hay cualquier
candado tomado.

**Impacto** — Es invisible para el resto del sistema (otra PC, el admi, el servidor) y se
pierde al reinstalar. Además queda congelada cuando un candado se cuelga (ver D-19).

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §3

---

## D-19 · Nueve candados independientes y un botón para destrabarlos a mano

**Evidencia** — `_drexGlobalBusy`, `_watchdog.busy`, `_v154pParcialBusy`,
`_portalSolicitudOperacionEnCurso`, `_operacionManualEnCurso`, `_cotejoDeclarando`,
`_drexSinSesion`, `_loteEnCurso` y `_drexCola`. Los libera a mano `liberarLockAgentes`
([chunior-recuperacion-y-transferencias.js:5-22](renderer/core/chunior-recuperacion-y-transferencias.js#L5-L22)),
cuyo comentario dice que antes soltaba cuatro y dejaba cuatro tomadas.

**Impacto** — Es el "otra operación está siendo procesada" que traba todo. Ninguno vence
solo: una operación que muere a mitad de camino deja el candado tomado para siempre.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §7

---

## D-20 · El motivo de rechazo no aparece donde hace falta · CORREGIDO

> **Corrección (2026-09-06).** La primera versión de esta ficha decía que el motivo «no se
> le muestra a nadie». **Era falso** y se escribió antes de tener el código del portal. El
> portal **sí** lo muestra: `landing_historial_usuario` devuelve el `motivo` desde
> `metadata.motivo` para los estados rechazados, y `pintarHistorialUsuario` lo pinta en la
> pantalla de Estado; la tarjeta de rechazo también usa el `mensaje` de
> `landing_estado_solicitud_segura`. Lo que sigue abajo es lo que de verdad faltaba.

**Evidencia** — 4.892 rechazos en 30 días (3.281 CARGA + 1.611 RETIRO). La columna
`cierre_motivo` está en NULL el 100 % de las veces: el motivo vive sólo en
`metadata.motivo` (4.834 casos). Y el lugar donde el usuario lo necesita —cuando va a
mandar otra— no lo mostraba: `renderCarga()` y `renderRetiro()` dibujaban el formulario
sin decir nada del rechazo anterior.

Además: **cero** solicitudes en estado `CANCELADA` en 30 días — el usuario no puede
cancelar nada.

**Impacto** — La persona volvía a mandar exactamente lo mismo, con el mismo error, y se
la volvía a rechazar. Que el motivo estuviera enterrado dos pantallas más allá, en Estado,
no servía en el momento de decidir.

**Estado** — El aviso previo al reenvío quedó **RESUELTO** (ver §Portal al final: se
muestra el motivo del rechazo anterior si fue del mismo turno). Siguen ABIERTOS que
`cierre_motivo` no se escriba nunca y que no exista cancelación por el usuario ·
plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §5

---

## D-21 · La reversión es un segundo motor, escrito aparte y sin red de seguridad

**Evidencia** — `deshacerOperacion` ([historial-operaciones.js:433-482](renderer/core/historial-operaciones.js#L433-L482),
~50 líneas) hace exactamente lo mismo que `ejecutarOperacionManual`
([operaciones-manuales.js:403](renderer/core/operaciones-manuales.js#L403), ~240 líneas)
y llama a las **mismas** primitivas (`callDrex("cargarSaldo"/"retirarSaldo")`), pero
reimplementa el envoltorio desde cero:

| | `ejecutarOperacionManual` | `deshacerOperacion` |
|---|---|---|
| Guarda saldo pre/post | Sí ([:638-646](renderer/core/operaciones-manuales.js#L638-L646)) | **No** — descarta el resultado |
| Detecta duplicado (saldo saltó un múltiplo) | Sí (`_confianza`, [:659-666](renderer/core/operaciones-manuales.js#L659-L666)) | **No** |
| Detecta rechazo del casino | Sí (`_rechazoCasino`, [:667](renderer/core/operaciones-manuales.js#L667)) | **No** |
| Anota en Chunior sólo si quedó limpio | Sí (`aplicadoLimpio`, [:669](renderer/core/operaciones-manuales.js#L669)) | **No** — le alcanza `r.ok !== false` |
| Traza paso a paso | Sí | **No** |
| Hereda `solicitud_id` del original | n/a | **No** |

Los saldos **están en la respuesta**: `callDrex` devuelve `previousBalance` y
`newBalance`, que el motor real lee en las líneas 638-639. La reversión recibe el mismo
objeto `r` y sólo hace `const ok = r && r.ok !== false;` — los tira.

**Impacto medido** — 184 reversiones desde el 2026-06-29: **las 184 sin `saldo_pre`, sin
`saldo_post` y sin `solicitud_id`**. El 100 %. Y 13 sin número de Chunior (7 %, contra
0,17 % del camino del portal, que sí encola).

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §1-§2

---

## D-22 · Revertir no le avisa a la solicitud del portal

**Evidencia** — Cadena real de `Valeriaaok54` del 2026-09-06 (la del historial en pantalla):

| # historial | Hora | Tipo · Origen | Saldos | `solicitud_id` | `reversion_de` | Chunior | Estado |
|---|---|---|---|---|---|---|---|
| 181224 | 09:38:03 | CARGA · LANDING | 236,6 → 10.236,6 | 187759 | — | 9606464 | REVERTIDA |
| 181225 | 09:38:28 | RETIRO · MANUAL | **—** | **null** | 181224 | 9606465 | REVERTIDA |
| 181226 | 09:38:43 | CARGA · MANUAL | **—** | **null** | 181225 | 9606469 | OK |

La solicitud 187759 quedó en `ACREDITADA`, con `metadata.historial_id = 181224` y
`updated_at` de las **09:38:04**: nunca se enteró de la reversión de las 09:38:28 ni de
la re-carga de las 09:38:43. El puntero del portal apunta a una fila marcada `REVERTIDA`.

**Impacto** — **91 solicitudes** apuntan hoy a un historial `REVERTIDA` mientras ellas
siguen en `ACREDITADA` (60) o `PAGADA` (31). Además Chunior queda con 3 movimientos
(9606464, 9606465, 9606469) para lo que en neto es una sola carga, y las dos reversiones
entran a la bolsa `MANUAL` sin dueño de D-15.

*Nota menor:* `metadata.historial_id` es numérico en 138.133 solicitudes y UUID en 8 —
resto de una versión vieja.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §2

---

## D-23 · «Reintentar» es un TERCER motor y no le avisa al portal

**Evidencia** — `reintentarOperacion`
([historial-operaciones.js:330-430](renderer/core/historial-operaciones.js#L330-L430)) es la
tercera implementación de la misma operación (después de `ejecutarOperacionManual` y
`deshacerOperacion`, D-21). Al terminar hace **un solo** `update`:

```js
await supabaseClient.from('historial_ops').update({
  estado: nuevoEstado, chunior_movimiento_id: movChu, notas: 'Reintento manual [...]'
}).eq('id', historialId);
```

Grep sobre todo el bloque: **cero** referencias a `actualizarSolicitudPortal` o a
`landing_solicitudes`. El camino normal del portal
([operation-execution.js](renderer/portal/operation-execution.js)) sí llama a
`actualizarSolicitudPortal`.

**Impacto** — Reintentar arregla la fila del historial y deja la solicitud del portal en el
estado viejo: el usuario nunca se entera de que se resolvió. Es lo mismo que D-22 con la
reversión, por la misma causa: cada motor cierra sólo la parte que él conoce.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §2

---

## D-24 · El vínculo con la solicitud se pierde justo cuando la operación falla

**Evidencia** — Filas de `historial_ops` cuyas `notas` dicen «Solicitud portal #…», últimos
60 días:

| Estado | Filas | Sin `solicitud_id` |
|---|---:|---:|
| OK | 133.968 | **0** |
| **ERROR** | **1.385** | **901 (65 %)** |
| REVERTIDA | 87 | 0 |

Caso real de `antobatiston` (2026-09-06):

| # | Hora | Estado | Saldos | `solicitud_id` | Notas |
|---|---|---|---|---|---|
| 181320 | 11:12 | ERROR | — | **null** | «Solicitud portal #187858 · … · Usuario no encontrado» |
| 181321 | 11:13 | OK | 42,27 → 3.542,27 | 187858 | «Solicitud portal #187858 · …» |

La fila que falló **sabe** a qué solicitud pertenece —lo dice en el texto de `notas`— pero
la columna quedó en NULL. El vínculo estructurado se escribe sólo cuando sale bien.

**Impacto** — Es el peor momento posible para perderlo: 901 operaciones fallidas en 60 días
que no se pueden reconectar con su solicitud salvo parseando texto libre. Y por eso
«Reintentar» (D-23) no podría avisarle al usuario aunque quisiera: no sabe a quién avisarle.

**Estado** — ABIERTO · plan en [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §1

---

# PORTAL · arreglado el 2026-09-06

Archivo [Portal](Portal) (2.317 líneas, sin trackear en git). Sintaxis verificada con
`node --check`. Nada de esto toca la base ni las RPC.

## P-01 · El botón de enviar quedaba muerto en «Enviando…» · RESUELTO

`enviarSolicitudCargaDirecta` deshabilitaba el botón y `enviarSolicitudCarga` tenía **seis
salidas tempranas** que nunca lo volvían a habilitar. La más fácil de disparar: un titular
de dos letras pasa `marcarFaltantes` (no está vacío) y muere en
`if(String(titular).trim().length<3)`. El botón quedaba en «Enviando…» para siempre y la
única salida era cambiar de pantalla y volver.

Arreglo: `try/finally` con `_restaurarBoton()`, que no toca nada si la solicitud sí se creó
(ahí la pantalla ya cambió a Estado). Mismo arreglo en los dos cortes del retiro.

## P-02 · La solicitud fantasma que trababa el portal entero · RESUELTO

En retiro se guardaba `setPendiente("RETIRO", "pendiente-local-"+Date.now())` cuando la RPC
no devolvía id, y en carga `setPendiente("CARGA","")`. Ese id no existe en la base, así que:

- `tieneSolicitudPendiente()` daba true → **bloqueaba toda carga y todo retiro nuevo**,
- `startEstadoPoll()` consultaba la **solicitud 0** cada 6 s, para siempre,
- en retiro además arrancaba el cooldown de 24 h por un retiro que nunca se creó.

La única salida era «Marcar como resuelta en este dispositivo», que casi nadie encuentra.
Es exactamente el «queda colgado y traba todo». Pasa de verdad: el tercer fallback
(`landing_crear_chat_v2_blindado`) **no crea solicitud**, sólo un chat.

Arreglo: sin nº numérico real no se marca pendiente. Se avisa «lo tomamos por el chat», se
abre el chat y el portal queda libre.

## P-03 · Poll eterno contra la solicitud 0 · RESUELTO

`solicitudIdValido()` devolvía el string crudo cuando no era numérico, y los dos consumidores
hacían `typeof sid==="number"?sid:0` → preguntaban por la solicitud 0. Ahora devuelve `null`
si no es numérico y no se consulta nada.

## P-04 · Motivo del rechazo anterior antes de reenviar · RESUELTO

`renderCarga()` y `renderRetiro()` ahora muestran arriba del formulario el motivo del último
rechazo **si fue dentro del mismo turno**. Usa `landing_historial_usuario`, que ya devolvía
el `motivo` — no hizo falta tocar el servidor.

**A confirmar:** el turno está definido como bloques de 8 h (00-08 / 08-16 / 16-24), que es
como se etiquetan TM/TT/TN. Es la constante `TURNO_HORAS` en el Portal. Si los horarios
reales son otros, se cambia sólo ahí.

## P-05 · Listener de visibilidad duplicado · RESUELTO

Había dos `visibilitychange` haciendo lo mismo; los dos arrancaban los polls en cada cambio
de pestaña. No creaba timers de más (cada `start` hace su `stop`), pero duplicaba las
consultas del arranque contra Supabase. Quedó uno.

## Lo que NO toqué en el portal, y por qué

- **El cooldown de «1 retiro por día» vive en `localStorage`** (`_retiroKey()`). Se saltea
  borrando datos del navegador o cambiando de teléfono. Es una regla de negocio que
  debería estar en el servidor — no es un arreglo de una línea.
- **La cascada de tres RPC** (`v16` → `v3_blindado` → `chat_v2_blindado`). El tercer escalón
  no crea solicitud, y por eso existía P-02. Sacarlo cambia el comportamiento ante una caída
  de la RPC principal: hay que decidirlo, no improvisarlo.
- **`state.seenMsgIds` / `shownTexts` crecen sin tope** en sesiones largas. Impacto bajo.
- **Nada del `codigo_op`** (SISTEMA_ENLACE §1): eso necesita migración y tu decisión de
  formato antes de escribir una línea.

---

## D-25 · La guarda antiduplicados de 5 minutos apunta a una tabla muerta

**Evidencia** — `landing_puede_crear_solicitud_5min` consulta `public.solicitudes`. Esa tabla
tiene **156 filas y su última escritura es del 2026-05-30**. Las solicitudes reales van a
`public.landing_solicitudes` (187.872 filas, activa hoy). El trigger que la aplica,
`trg_landing_bloqueo_5min_solicitudes`, también está montado sobre `solicitudes`.

**Impacto** — La regla nunca frena nada: busca duplicados donde ya no se escribe, así que
siempre devuelve `ok=true`. Hay una protección antiduplicados que todos creen activa y que
en la práctica no existe desde hace más de tres meses.

**Estado** — ABIERTO · afecta [SISTEMA_ENLACE.md](SISTEMA_ENLACE.md) §10.3

---

## D-26 · `tomada_por_operador_id` no se escribe nunca

**Evidencia** — En 7 días: 19.056 cargas y 1.269 retiros, **todos** con
`tomada_por_operador_id` en NULL. La columna existe en `landing_solicitudes` junto con
`tomada_por_operador_nombre` y `tomada_at`.

**Impacto** — No se puede saber si una solicitud está siendo atendida. Eso bloquea el criterio
central de la expiración automática (§10.2) y deja sin respaldo cualquier reparto de trabajo
entre operadores.

**Estado** — ABIERTO

---

## D-27 · El cambio de clave del portal nunca llegaba a NODO · RESUELTO

**Evidencia** — `landing_portal_v16_crear_solicitud` abría con:

```sql
if v_tipo not in ('CARGA','RETIRO','SOPORTE') then raise exception 'TIPO_INVALIDO'; end if;
```

`CAMBIO_CLAVE` no estaba en la lista, así que la RPC tiraba excepción, el portal caía a su
tercer fallback (`landing_crear_chat_v2_blindado`) y el pedido terminaba como **un mensaje de
chat suelto, sin solicitud**. Medido: **0 solicitudes de tipo CAMBIO_CLAVE en 30 días**.

El resto de la cadena ya existía y estaba bien: `ejecutarAutoClave(id)` en NODO hace el trabajo
completo (busca al usuario, cambia la clave, actualiza la solicitud y avisa por chat), y la
tabla de lotes ya tenía su botón. Nadie lo había conectado porque nunca llegaba nada.

**Impacto** — La pantalla «Reiniciar clave» del portal parecía andar (decía «enviada 🔑») y no
generaba ningún pedido. El operador se enteraba sólo si leía el chat.

**Estado** — **RESUELTO** el 2026-09-06, migración `portal_v16_permitir_cambio_clave`:
se agregó el tipo a la lista permitida y **al blindaje de vínculo** — un reseteo cambia el
acceso a la cuenta de juego, así que exige usuario+teléfono cotejados igual que una carga o un
retiro; sin eso cualquiera con el link podría pedir la clave de una cuenta ajena. Verificado que
el resto de la función quedó intacto (monto sólo para CARGA/RETIRO, sin default P1, resolución
por host, origen e insert sin cambios).

---

## D-28 · La clave que elegía el usuario se perdía siempre · RESUELTO

**Evidencia** — `mapSolicitudPortal` hacía `PASSWORD_NUEVO: s.password_nuevo || ""`, pero el
portal manda la clave **dentro de `p_metadata`** y `landing_solicitudes` **no tiene** columna
`password_nuevo`. Leyendo sólo la columna, el valor llegaba siempre vacío y
`ejecutarAutoClave` caía a su default `"12345a"`.

Es el mismo error que ya habían encontrado con `TELEFONO`, que tiene el arreglo —y el
comentario que lo explica— tres líneas más arriba en el mismo archivo.

**Impacto** — Aunque la solicitud hubiera llegado, la persona pedía una clave y le poníamos
otra.

**Estado** — **RESUELTO** · [data.js:107](renderer/portal/data.js#L107) ahora cae a
`meta.password_nuevo`.

---

# PENDIENTES · al 2026-09-06

Lo que quedó sin hacer, con lo que hace falta para cerrarlo.

## Pedido y NO empezado

| Qué | Qué falta | Bloqueante |
|---|---|---|
| **«¿Transferiste a otra billetera?»** | Mostramos un solo CBU activo; el que transfirió a otro no tiene cómo avisar salvo escribiendo. Criterio acordado: lista cerrada de NUESTRAS billeteras (no texto libre), aparece en **Estado** después de enviar (no en Cargar), se cuenta por usuario, y la solicitud llega marcada `⚠ OTRA BILLETERA · verificar`. | RPC nueva `landing_listar_billeteras_oficina(p_public_code)` → devuelve nombre + alias, **sin CBU**. |
| **Sistema de validación** | Varios caminos distintos haciendo a medias el trabajo de uno. Ver el artefacto de revisión. Juan lo dejó explícitamente para más adelante. | Decisión de diseño: cuál manda. |
| **Campaña real (reemplazo de la push eliminada)** | Se sacó el disparo masivo a ciegas (D-36). Una campaña de verdad tiene que mostrar **a quién** (lista con nombres, editable), **a cuántos** (con push activo, dato del servidor) y **por qué** (motivo guardado con el envío) antes de mandar. Hoy no queda registro de ningún envío. | Segmentación desde **Nexo**, no desde `buildCRM()`. Tabla de envíos para el registro. |
| **N° de movimiento de Chunior incompleto** | ~1,4 % de cargas/retiros no guardan ninguno. (`RESET_CLAVE` y `CONSULTA` ya NO cuentan acá: no pasan por Chunior, ver D-38.) Sin ese número no hay cotejo posible. | Revisar si cambió el HTML del mensaje de éxito de Chunior. |
| **Editar un movimiento ya anotado en Chunior** | Hoy sólo se puede *anular* propinas y depósitos sin reclamar (se les pone monto 0,10). No hay forma de corregir monto, billetera ni notas desde NODO. Pedido explícito de Juan: «acceso fácil y rápido a editar todo». | Definir qué se puede editar sin romper el cotejo: Chunior no versiona los cambios. |
| **Cambio de billetera ambiguo en el historial** | Se muestra el valor final donde hubo una transición. Propuesta: `MASSA PP → CASTRO` con quién y cuándo, ícono 🔀 y filtro «cambiadas». | Pospuesto por Juan. |

## Hecho pero con límite conocido

- **Cola de carga** (nueva): vive **en memoria**, no en `localStorage`. Si se cierra la app con solicitudes encoladas no se pierde nada —siguen `PENDIENTE` en el portal y vuelven a la bandeja— pero no se auto-ejecutan. Serializarla a disco requiere no guardar el `ctx` entero.
- **«Cancelar solicitud»** del portal: sólo limpia el estado **en el teléfono**. La solicitud sigue viva de nuestro lado. La cancelación real necesita servidor (§5 de SISTEMA_ENLACE).
- **Cooldown de 1 retiro/día**: en `localStorage`. Se saltea borrando datos del navegador o cambiando de teléfono.
- **Turno = bloques de 8 h** (00-08 / 08-16 / 16-24) en la constante `TURNO_HORAS` del Portal. **Sin confirmar** contra los horarios reales de TM/TT/TN.
- **Ventana del cambio de clave automático**: 25 s, en `CLAVE_AUTO_SEGUNDOS`. Sin probar con operadores.

## Del servidor, sin tocar

- **D-25** · la guarda antiduplicados de 5 min apunta a una tabla muerta desde mayo.
- **D-26** · `tomada_por_operador_id` en NULL el 100 %: bloquea el criterio central de la expiración automática.
- **§10 de SISTEMA_ENLACE** · criterios de expiración: retiros 90 min, cargas nunca por tiempo solo. Sin implementar.
- **`codigo_op`** (§1) · falta decidir el formato antes del backfill de 183.895 filas.

---

## D-29 · La búsqueda del CRM traía 124.843 teléfonos por un dígito suelto · RESUELTO

**Evidencia** — `panel_crm_perfil_v1` hacía `v_qd := regexp_replace(v_q,'\D','','g')` —los dígitos
sueltos de la query— y después `telefono_canon like '%'||v_qd||'%'`. Buscar `redpoint1` dejaba
`v_qd = '1'` y matcheaba **todo teléfono con un 1 adentro**. Medido:

| Búsqueda | Antes | Ahora |
|---|---:|---:|
| `redpoint1` | **124.843** | 0 |
| `1166489726` | 2 | 2 |
| `5491166489726` | **0** | 2 |
| `+54 9 11 6648-9726` | **0** | 2 |

La RPC cortaba a 100 candidatos, así que devolvía basura arbitraria y el usuario buscado nunca
llegaba a entrar en el corte.

**Impacto** — La búsqueda del CRM era inutilizable con cualquier query que tuviera un número.
Y buscar el teléfono en formato internacional (como lo copia todo el mundo desde WhatsApp) no
encontraba nada, porque `telefono_canon` se guarda sin el `549`.

**Estado** — **RESUELTO** · migración `crm_perfil_busqueda_telefono_y_motivo`: sólo se busca por
teléfono con 6+ dígitos, se comparan los **últimos 10 dígitos** de los dos lados (el `54`, `549`,
`0` y `15` dejan de importar), y el resultado exacto va primero para que el límite no lo corte.

---

## D-30 · El CRM se repintaba encima del operador mientras escribía · RESUELTO

**Evidencia** — `renderCRM()` reescribe el `innerHTML` de toda la vista, y hay **dos disparos
tardíos**: `setTimeout(…, 1000)` al arrancar, y el override de `mostrarVista` que espera a
`cargarOperacionesAgente()` (~2 s según el comentario del propio código) y recién ahí repinta.

**Impacto** — Abrías el CRM, empezabas a escribir, y a los segundos se te borraba el texto. Había
que esperar a que el campo volviera a existir para tipear de nuevo.

**Estado** — **RESUELTO** · `renderCRM` no repinta si el buscador tiene el foco o algo escrito.
Protege todos los call sites de una vez.

---

## D-31 · Cada resultado del CRM no decía por qué aparecía · RESUELTO

Se mezclaban coincidencias de usuario, teléfono y titular sin distinguirlas. Ahora cada fila
lleva su motivo: `🎯 exacto` · `👤 usuario` · `📱 teléfono` · `🧾 titular`.

**Pendiente de esta idea:** sumar **misma IP** como motivo. Hoy no se guarda: `landing_solicitudes.metadata`
tiene `host`, `navegador`, `pc_codigo` — pero **no la IP**. Habría que capturarla en el portal al
crear la solicitud. No da la dirección exacta, pero sirve para dos cosas: saber de qué tipo de
lugar entra la gente y, sobre todo, **detectar varias cuentas desde la misma casa** — otra forma
de agarrar a los que cazan bonos.

---

## D-32 · Abrir el CRM bajaba 64.000 filas para tirarlas · RESUELTO

**Evidencia** — El override de `mostrarVista` llamaba a `cargarOperacionesAgente()` cada vez que
se entraba a Jugadores. Esa función encadena **cuatro RPC**, una esperando a la otra
([historial-operaciones.js:78-101](renderer/core/historial-operaciones.js#L78-L101)):
`panel_crm_agente_resumen` → `panel_crm_flags` → `panel_crm_vinculos` → `panel_crm_vinculos_count`.

La tercera baja los vínculos de la oficina entera:

| Oficina | Vínculos que bajaba |
|---|---:|
| P6 | **64.121** |
| P2 | **54.138** |
| P4 | 13.757 |
| P7 | 751 |

**Y se descartaba todo.** `buildCRM()` abre con `if(!window._crmCargado){ … return []; }`: la
vista arranca vacía a propósito y trabaja por búsqueda contra el servidor. Nada de lo que
bajaban esas cuatro RPC se miraba, salvo que el operador pidiera 📥 Cargar lista.

**Impacto** — Segundos de red y de parseo en cada apertura de la pestaña, para nada. Y al
terminar disparaban el `renderCRM` tardío que le borraba el texto al operador (D-30): el
repintado no era el problema, era el síntoma de esto.

**Estado** — **RESUELTO** · las cuatro RPC corren sólo si `_crmCargado`. Con la vista vacía se
pide únicamente `panel_crm_vinculos_count`, que es un `count(*)` y alimenta el contador
«Registrados (WTK)».

---

## D-33 · La IP de quien manda la solicitud · HECHO en el portal

Antes no se guardaba: `landing_solicitudes.metadata` tenía `host`, `navegador` y `pc_codigo`,
pero nada de red. El portal ahora la pide una vez por sesión y la manda en `metadata.ip`, tanto
en CARGA como en RETIRO. Con timeout de 2,5 s y cacheada: si falla, la solicitud sale igual —
esto nunca puede frenar un envío.

**Para qué** — Detectar **varias cuentas desde la misma casa**, que es otra forma de agarrar a
los que cazan bonos.

**Cómo leerla, importante** — En redes móviles y en barrios con CGNAT muchos vecinos comparten
la misma IP pública. Coincidir **no prueba** que sean la misma persona: es una señal para
mirar, no una condena. Si se usa para bloquear automático, va a haber falsos positivos.

**Falta** — mostrarla como motivo en el CRM (`📍 misma IP`) una vez que haya datos acumulados.
Hoy la RPC de búsqueda no la mira.

---

## D-34 · Los contadores del CRM salían siempre en cero · RESUELTO

**Evidencia** — Total / VIP / Activos / Tibios / Fríos se calculaban sobre `buildCRM()`, que
abre con `if(!window._crmCargado){ return []; }`. Como la vista arranca vacía a propósito y
trabaja por búsqueda, esos cinco números eran `0` **casi siempre**. Y aun con la lista cargada
contaban sólo lo que esa PC había bajado, no la oficina.

**Estado** — **RESUELTO** · se sacaron los cinco. Queda «Registrados (WTK)», que es un
`count(*)` del servidor y sí es cierto.

**Decisión de Juan:** la segmentación real la tiene que dar **Nexo**, que ve todas las
operaciones en vez de una copia local parcial. Pendiente de implementar del lado de Nexo.

---

## D-35 · IP a Nexo · HECHO · y por qué NO se bloquea por IP

El portal ya manda `metadata.ip` (D-33). Ahora NODO la reenvía a Nexo en el payload por usuario:
`ips: [{ip, veces, ultima}]`, tope de 12 por usuario, ordenadas por frecuencia.

**NODO no la guarda en ninguna base propia.** Se lee de las solicitudes que ya están en memoria
y se reenvía. La acumulación histórica vive en Nexo, que es donde tiene sentido cruzarla —
decisión explícita de Juan: *«no los guardes mucho tiempo en NODO, no son necesarios, solo son
posibles ganchos para saber cuántas probabilidades hay de que un usuario sea la misma persona o
cercana»*.

### Bloqueo por IP: DESCARTADO a propósito

Juan lo planteó y lo descartó él mismo, con el argumento correcto: **no se le entrega un bloqueo
automático a operadores que no controla.** Queda anotado para que nadie lo «agregue» más adelante
pensando que es una mejora:

- Con **CGNAT** y redes móviles, muchos vecinos comparten la misma IP pública. Un bloqueo deja
  gente afuera por vivir en el edificio equivocado.
- Son **siete oficinas** con criterios distintos. Un bloqueo automático se aplica igual en todas
  y nadie va a poder explicarle a la persona por qué no puede operar.
- La IP es **una señal para mirar, no una prueba.** Sirve para ordenar a quién revisar primero,
  no para decidir solo.

---

## D-36 · Campaña Push · ELIMINADA · mismo criterio que el bloqueo por IP

**Qué había** — Una tarjeta «📣 Campaña Push» en el CRM: elegís un segmento (VIP / Activo /
Tibio / Frío / Nuevo o *todos*), escribís título y mensaje, y un botón **Enviar campaña**
disparaba una notificación push a esa lista entera de una.

**Evidencia de que no podía funcionar bien** — el segmento salía de `buildCRM()`, la misma
función que rompía los contadores de D-34:

```js
const data = window._crmJugadoresData || buildCRM();
const targets = seg ? data.filter(j => U(j.segmento) === U(seg)) : data;
```

y `buildCRM()` abre con `if(!window._crmCargado){ return []; }`. O sea:

- Sin apretar «Cargar lista» → `targets` vacío → *«No hay jugadores para ese segmento»*.
- Con la lista cargada → manda a **lo que bajó esa PC**, no a la oficina. El operador no tenía
  forma de saber a cuántos ni a quiénes le estaba escribiendo hasta después de mandar, cuando
  el resultado decía «N enviados».

Es exactamente el problema de D-34, pero en vez de dibujar un número equivocado, **manda
notificaciones a gente real**.

**Estado** — **ELIMINADA** · se sacaron la tarjeta, `crmEnviarCampania()` y `campAutoTexto()`
(esta última sólo existía para autocompletar el texto de la campaña). −3.517 bytes.

**Lo que queda y sigue andando** — el push **de a un jugador**: el botón `📲 Push` de cada fila
del CRM y el del perfil (`perfil-jugador.js:251`), los dos van a `crmPushIndividual()`. Ese sí
sabe a quién le manda, porque el operador lo eligió. También sigue intacto el push propio de la
cola de reconexión (línea ~726), que nunca usó la campaña. Eso es la reducción que pidió Juan:
*«en todo caso la reducimos a un botón de notificación y dejaría de ser campaña»*.

**Criterio de Juan, textual:** *«bajo el mismo criterio del bloqueo de ip... no me parece lógico
ese sistema»*. Un disparo masivo a ciegas es lo mismo que un bloqueo automático: una acción que
afecta a mucha gente de una, en manos de operadores que no controla, sin que nadie pueda decir
después a quién le llegó.

### Si algún día se hace una campaña de verdad, requisitos

No es «volver a poner el botón». Una campaña sirve para **promoción** o para **avisar un
cambio**, y antes de mandar tiene que poder responder tres preguntas en pantalla:

1. **A quién** — la lista concreta, con nombres, revisable y editable antes de disparar. No un
   segmento abstracto calculado en el navegador de esa PC.
2. **A cuántos** — el número real de destinatarios **con suscripción push activa**, del
   servidor, no del cache local.
3. **Por qué** — el motivo queda escrito y guardado con el envío: qué promo, qué cambio, quién
   la mandó y cuándo. Hoy no queda registro de ningún envío en ningún lado.

Además: la segmentación tiene que venir de **Nexo** (misma conclusión que D-34), no de
`buildCRM()`. Y conviene un tope por operador y por día, más un preview del mensaje tal como lo
va a ver el jugador.

---

## D-37 · Lo de Chunior vivía 9 horas y no se podía cotejar · RESUELTO (parcial)

Planteo de Juan: *«las actividades de Chunior están únicamente limitadas al historial de el
inicio, historial el cual está limitado por dos días por ende no es cotejable, así mismo no
tenemos información sobre esos números de movimiento ni acceso fácil y rápido a editar todo,
los de Chunior también deberían de desplegar información en el centro de solicitudes»*.

### Lo medido — era peor que dos días

`cargarHistorial()` traía `.limit(200)` fijo, sin ventana de tiempo. Contra la base, 200 filas
por oficina son:

| Oficina | Filas/día | Lo que cubren 200 filas |
|---|---:|---:|
| P4 | 813 | **9,1 h** |
| P2 | 712 | **9,3 h** |
| P3 | 516 | 10,0 h |
| P7 | 518 | 11,8 h |
| P6 | 364 | 13,5 h |
| P5 | 187 | 30,9 h |

En las oficinas grandes **no alcanzaba ni para el turno en curso**. Y encima el Centro de
Solicitudes filtra por turno actual arriba de eso.

### Los movimientos de Chunior, invisibles

Los que no nacen de una solicitud del portal —transferencias entre billeteras, depósitos sin
reclamar, propinas, recargas de fichas, cambios de clave, consultas— sí se escriben en
`historial_ops`. En 30 días:

| Tipo | Filas 30 d | Con N° de movimiento |
|---|---:|---:|
| DEPOSITO_SR | 283 | 283 |
| CAMBIO_BILLETERA | 240 | 233 |
| MOV_BILLETERA | 139 | 135 |
| RESET_CLAVE | 744 | **0** |
| CONSULTA | 539 | **0** |
| RECARGA_FICHAS | 2 | 0 |
| PROPINA | 2 | 2 |

**666 movimientos administrativos de Chunior en 30 días. El panel mostraba 21.** El resto
quedaba fuera de la ventana de 200 filas y no había forma de llegar a ellos. Los que sí
entraban se pintaban con el tipo crudo en mayúsculas (`DEPOSITO_SR`), sin ícono ni nombre.

### El buscador prometía algo que no hacía

El placeholder dice *«Buscar jugador, N° de movimiento, CBU, tel...»*. El código sí mira
`chunior_movimiento_id`… pero **sólo dentro de las 200 filas en memoria**. Un número de ayer
no aparecía nunca. Y en la base **no existía índice** sobre `chunior_movimiento_id`: el único
índice de movimiento era `idx_historial_ops_mp_movimiento_id`, que es el de MercadoPago, no el
número que el operador tiene delante cuando cotea contra Chunior.

### Qué se hizo

1. **La ventana se mide en tiempo, no en filas.** `_histVentana()` en
   `historial-operaciones.js`. En «Turno actual» arranca donde arrancó el turno con un piso de
   12 h —si son las 06:10 el operador igual necesita ver lo que dejó el turno anterior.
2. **Selector de período** en el Centro de Solicitudes: Turno actual / 24 h / 7 días / 30 días.
   Cambiarlo **reconsulta al servidor** (`setHistorialPeriodo`), que es la única forma de ver
   lo que quedó afuera.
3. **Búsqueda contra el servidor** (`buscarHistorialServidor`): si no hay nada en lo cargado,
   aparece **🔎 Buscar en todo el historial**. Un número de movimiento se busca en **todas las
   oficinas** a propósito —el número es de Chunior, no de la PC, y al cotejar no siempre se sabe
   dónde se cargó. Los resultados llegan marcados `📅 fecha · oficina` y **saltan el filtro de
   turno**: si el operador pidió algo de otro día, esconderlo sería devolverle una lista vacía.
4. **Índice nuevo** — migración `historial_ops_indice_chunior_movimiento_id`, parcial sobre
   `chunior_movimiento_id is not null`.
5. **Pestaña 🔧 Chunior** en el Centro de Solicitudes, que agrupa los siete tipos. Fuerza turno
   = TODOS: son ~3 por día por oficina, filtrarlos por turno los deja casi siempre en cero.
6. **Nombres legibles**: 🔀 TRANSFERENCIA, 💳 CAMBIO BILLETERA, 💜 DEPÓSITO S/RECLAMAR,
   🎁 PROPINA, 🎰 RECARGA FICHAS, 🔑 CAMBIO DE CLAVE, 🔍 CONSULTA. El badge de origen ahora
   dice **Chunior** en vez de **Manual** cuando corresponde.
7. **Cartel de ventana** (`histVentanaInfo`): dice siempre *«Cargadas últimas N h · M
   movimientos»*. Lo que no está cargado no existe para los filtros ni para el buscador, y el
   operador tiene que saberlo **antes** de concluir «no está».
8. **Tope de 500 filas** en la tabla del Historial de Inicio, con aviso de cuántas quedaron. Se
   arma entera en un `innerHTML`: sin tope, elegir «30 días» en P4 son 8.000 `<tr>` de un saque.

### Lo que queda pendiente

- **`RESET_CLAVE` y `CONSULTA` no guardan N° de movimiento** (0 de 1.283 en 30 días). No es un
  bug de visualización: nunca se scrapea. Para `RESET_CLAVE` hay página de Chunior y se podría
  capturar igual que en `_registrarAdminChunior`.
- **1.173 CARGAS y 202 RETIROS sin N°** en 30 días (~1,4 %). Son los casos en que el parser del
  mensaje de éxito no encontró el número: `_registrarAdminChunior` los da por buenos con
  `[CHUNIOR_OK_SIN_N]`. Habría que revisar si cambió el HTML de Chunior.
- **«Acceso fácil y rápido a editar todo»** — sin hacer. Hoy sólo se puede *anular* propinas y
  depósitos sin reclamar (`_anularMovimientoChunior`, que pone el monto en 0,10). No hay
  edición de monto, billetera ni notas de un movimiento ya anotado.

---

## D-38 · La ficha del expediente mentía y las filas de Chunior estaban muertas · RESUELTO

Juan, mirando el resultado de D-37: *«no hiciste una verga bld, armá un historial con datos
utilizables con eso, de qué me sirve saber el lead de cambio de clave y que aparezca registrado
en el Chunior si no lo hace, vos mismo lo decís, fijate»*. Tenía razón en las dos.

### 1 · Las tarjetas de Chunior no abrían nada

Se agregó la pestaña 🔧 Chunior en D-37, pero al hacer clic el panel derecho decía **«Solicitud
no seleccionada»**. La causa no era de la pestaña: `operation-modal.js` busca la fila en
`window._histUnificadoCache` y en `window._historialData`, y **ninguna de las dos existía**.

```js
let _histUnificadoCache = [];   // historial-unificado.js
let _historialData = [];        // historial-movimientos.js
```

Son `let` de script clásico: **no son propiedades de `window`**. Así que
`deps.window._histUnificadoCache` era `undefined` y el expediente sólo resolvía las solicitudes
del portal, que vienen por otro camino (`V154P.solicitudes`).

Esto no lo rompió la pestaña: **toda fila manual venía siendo una fila muerta desde antes**. La
pestaña sólo lo hizo evidente. De regalo, `jugadores-crm.js` también lee `window._historialData`
y siempre recibía `undefined`.

**Resuelto** — se publican las dos: `window._histUnificadoCache = lista` y
`window._historialData = _historialData`.

### 2 · La ficha decía que el cambio de clave pasa por Chunior. No pasa.

El expediente pintaba **la misma ficha de carga/retiro para todo**. Un `CAMBIO_CLAVE` mostraba:

| Campo | Lo que decía | La verdad |
|---|---|---|
| Monto de la operación | `$ 0` | un cambio de clave no tiene monto |
| Billetera asignada | `Sin billetera` | no interviene ninguna billetera |
| N° Movimiento Chunior | `Sin movimiento` | **nunca va a haber uno** |
| Saldos en casino | `Prev — Post —` | no se leen saldos |
| Flujo, paso 2 | `Chunior · Pendiente` | **no se completa nunca** |

El cambio de clave se ejecuta con `callDrex("cambiarClave", ...)` —el backoffice del **Agente /
Drex**, no Chunior. Es coherente con lo medido en D-37: 744 `RESET_CLAVE` en 30 días, **0 con
número de movimiento**. No es que falte scrapearlo: no existe.

Un operador mirando esa ficha concluye que la operación quedó a medias y sale a buscar un
número que no va a encontrar.

**Resuelto** — el expediente ahora se arma según el tipo:

- **CAMBIO_CLAVE / RESET_CLAVE** → Usuario · **Clave nueva** (copiable) · Teléfono · Mensaje.
  Columna derecha: *Se ejecuta en: **Agente / Drex*** y *Movimiento en Chunior: **No corresponde
  · un cambio de clave no mueve plata***. Flujo: `1. Pedido → 2. Agente → 3. Clave nueva → 4. estado`.
  Si no llegó clave, lo dice: *«No llegó ninguna clave — se aplica la del sistema»*.
- **Movimientos de Chunior** (transferencia, cambio de billetera, depósito s/reclamar, propina,
  recarga) → título **🧾 Detalle del movimiento** en vez de «Datos del Jugador» (el campo
  `usuario` en estos trae un concepto, no un jugador), con N° de movimiento, monto, billetera,
  notas y operador. Sin titular ni CBU, que no existen acá.
- **CONSULTA** → sin monto ni Chunior.
- **CARGA / RETIRO** → igual que siempre, sin cambios.

Además, donde falta el N° ya no dice un neutro «Sin movimiento»: dice **«Sin N° anotado —
todavía no se ejecutó»** o **«— quedó sin registrar»** según el estado, que es información
distinta y accionable.

### 3 · En la lista, el cambio de clave mostraba `—`

La tarjeta pone el monto en grande. En un cambio de clave eso era un guión. Ahora muestra
**🔑 la clave nueva**, que es el dato de esa operación, o «sin clave» en rojo.

### 4 · Dos desplegables idénticos

D-37 dejó *«🕒 Turno actual»* y *«📥 Turno actual»* uno arriba del otro, indistinguibles. Ahora
son **«📥 Traer: …»** (cuánto se pide al servidor) y **«🕒 Ver: …»** (qué se muestra de lo traído).

### Prueba

`tests/expediente-por-tipo.test.cjs` — 5 casos que arman la ficha de verdad y verifican que cada
tipo muestre lo suyo y **no** lo que no le corresponde. Suite: 55/55.

---

## D-39 · Billetera vieja: el jugador no refrescó el portal · RESUELTO

**Planteo de Juan** — *«algunos usuarios no refrescan antes de subir la solicitud, no se ve la
billetera a la que transfirieron hasta que abrís el desplegable, deberías de avisar de alguna
manera que no es la misma que está en portal porque el usuario no refrescó»*.

### Corrección a lo que había medido en D-38

En D-38 medí «0 de 81.471 cargas con destino distinto de la billetera asignada» y concluí que
el dato no existía. **Esa medición respondía otra pregunta.** Comparé `metadata.destino` contra
`metadata.billetera_nombre`, y esos dos salen de **la misma foto del portal**: siempre coinciden
por construcción.

El desfase real es contra la billetera **activa ahora**: la persona deja el portal abierto,
nosotros cambiamos la billetera, y manda la solicitud sin refrescar. La solicitud llega con la
billetera anterior adentro. Eso **sí** está en los datos:

| | 7 días |
|---|---:|
| Cargas | 19.437 |
| Con cambio de billetera respecto de la siguiente carga de la oficina | 452 |
| …con el cambio a menos de 3 minutos (o sea: llegó con la vieja) | **271 · 1,39 %** |

Unas 39 por día entre las siete oficinas.

### Qué se hizo

`_billeteraVieja(it)` compara la billetera de la solicitud contra `getBilleraLanding()` (por
`ID_BILLETERA`, y por nombre cuando el metadata viejo no trae id). Devuelve `{vieja, actual}`.

- **En la tarjeta de la lista**, arriba de todo: `⚠ Pagó a GIORDANO · ahora CASTRO`. Es lo que
  decide a qué billetera mirar, y hasta ahora había que abrir el desplegable para saberlo.
- **En la ficha**: la billetera asignada se pinta en ámbar y debajo va
  *«⚠ No refrescó el portal: transfirió a **GIORDANO**, la activa ahora es **CASTRO**»*.

**Sólo mientras la solicitud sigue abierta.** En una ya cerrada la billetera activa cambió mil
veces y el aviso sería ruido. **Sólo en cargas**: en un retiro pagamos nosotros, no aplica.

### Lo que NO cubre

Esto detecta que la persona vio **otra billetera nuestra**. No detecta que haya transferido a
una billetera que el portal nunca le mostró — para eso sigue haciendo falta el
«¿Transferiste a otra billetera?» que está en PENDIENTES.

---

## D-40 · Prueba de arranque del bundle

Varias veces en esta sesión pasó lo mismo: se entregaba algo que en pantalla no funcionaba. El
caso peor fue el buscador del N° de Chunior, que guardaba bien y no se dibujaba.

`tests/panel-arranque.test.cjs` levanta **el bundle generado** (`js-modules.js` + `js-core.js`,
en el mismo orden que el HTML) dentro de un `vm` con un DOM mínimo y verifica:

1. que arranque sin tirar;
2. que las diez funciones que usa la pantalla queden definidas;
3. que `_billeteraVieja` avise en los dos casos que corresponde y calle en los cuatro que no;
4. que la ventana del historial se mida en tiempo y el turno nunca baje de 12 h.

**Detalle que casi me come:** la primera corrida daba «sin aviso» en los seis casos. No era el
código: al arnés le faltaba `js-modules.js`, así que `normalizar()` tiraba `NodoDomain is not
defined`, el `try/catch` de `_billeteraVieja` se lo comía y devolvía `null`. El orden de carga
del test tiene que ser el mismo que el del HTML o el test miente.

Suite: 70/70.

---

## D-41 · Limpieza del CRM: filtros muertos, base local y registrados por oficina

Pedido de Juan: *«eliminá los filtros de la pantalla principal del CRM, son una verga y no
sirven. La base local por alguna razón no guarda usuarios, eliminala… los registrados en WTK
deben de ser por oficina, la oficina en la que iniciás sesión, en todo caso mostrá en formato
lista algunos y poné páginas para que se consulten en el momento, eso es un CRM»*.

### 1 · Los cuatro filtros

Segmento / turno / origen / orden filtraban sobre `buildCRM()`, la misma función de D-34 y de
la campaña eliminada: abre con `if(!window._crmCargado){ return []; }`. Sin apretar «Cargar
lista» filtraban **sobre una lista vacía**. Fuera los cuatro. Queda la búsqueda —que es la que
pega contra el servidor y sí funciona desde D-29— y el orden por score por defecto.

### 2 · La pantalla «📇 Base local»

Fuera, con una aclaración importante: **se sacó la pantalla, no el dato.**

El almacén (`_jugStoreAll` / `jugadorRegistrarDato`) lo leen **otras tres cosas**:

| Quién | Para qué |
|---|---|
| `perfil-jugador.js:127` | la ficha del jugador (CBUs, titulares, timeline) |
| `cotejo-alta.js:30` | el cotejo al dar de alta un usuario |
| `nexo.js:50` | lo que NODO le manda a Nexo |

Borrar el almacén rompía las tres. Lo que se fue son `mostrarBaseLocalJugadores` y su
refiltrado, que era la herramienta de desarrollo que nunca terminó de andar.

### 3 · Registrados: eran de las siete oficinas juntas

La tarjeta decía «Registrados (WTK)» con un número, y la llamada era:

```js
supabaseClient.rpc("panel_crm_vinculos_count", { p_pc_codigos: null, ... })
```

`p_pc_codigos: null` significa **todas las oficinas**. La RPC ya aceptaba el filtro; el panel
le pasaba `null`. Y encima era un número que no se podía abrir.

**Ahora**: `panel_crm_vinculos_listar(p_pc_codigos, p_q, p_limit, p_offset, p_secret)` devuelve
la página de registrados **de la oficina en la que estás logueado** (la que sale del login de
Chunior, vía `pcAliasesHist()`), con usuario, teléfono, titular, estado del vínculo, si tiene la
app y la fecha de alta, más el total al lado para paginar. 25 por página, con buscador propio
—usuario, titular o teléfono comparando los **últimos 10 dígitos**, mismo criterio que D-29— y
botones Anterior / Siguiente. Cada fila abre el perfil.

Verificado contra P1: **6.635 registrados**, con teléfono y estado.

Se sacaron además las **dos llamadas al contador global** que quedaron sin dónde pintarse: una
consulta menos cada vez que se abre la pestaña.

---

## D-41b · El CRM quedaba en «Cargando…» · y por qué

Primera versión de D-41: dos tarjetas —«Buscar jugador» y «Registrados en P1»— y la de abajo
se quedaba cargando para siempre.

**No era la base.** Medido: la consulta tarda **126 ms** para P1.

**Era una carrera en mi código.** `crmRegistradosCargar` abría con un candado booleano:

```js
if(!caja || st.cargando) return;
st.cargando = true;
```

`renderCRM()` repinta la vista **varias veces**: el override de `mostrarVista` y el `setTimeout`
de 1 s del arranque. La primera llamada tomaba el candado; el repintado siguiente creaba una
caja nueva y disparaba otra llamada que **se salteaba** por el candado; y la respuesta de la
primera terminaba escrita en la caja vieja, ya fuera del DOM. La que veía el operador se quedaba
en «Cargando…» sin que fallara nada, sin error en consola y sin nada que reintentar.

**Arreglado con un token de pedido** en vez de un candado: cada llamada toma un número, ninguna
se saltea, y al volver se descarta la respuesta si ya hay una búsqueda más nueva. Además la caja
se vuelve a buscar por id al momento de pintar, porque entre el pedido y la respuesta la vista
pudo haberse repintado.

### Rediseño, por lo que marcó Juan

*«no es necesario que P3 sepa que hay 2 oficinas atrás, los chicos no precisan saber eso… son
dos apartados distintos, no creo que sea bueno separarlos, si vamos al caso es la misma
búsqueda… hacé que sólo busque 10 usuarios y que permita filtrar de a más con un desplegable…
que cargue lo que el usuario quiera que cargue, acá no hay pestañas tampoco»*.

- **Una sola tarjeta.** Las dos hacían lo mismo: una filtraba lo que había en memoria, la otra
  pedía al servidor.
- **Sin nombre de oficina en pantalla.** El operador ya está adentro de la suya; saber que hay
  siete atrás no le sirve para operar. La oficina se sigue usando para filtrar la consulta, pero
  no se muestra.
- **10 por defecto**, con desplegable 10 / 25 / 50 / 100. Sin páginas: se trae lo que el
  operador pide.
- **Una lista a la vez.** Si buscás, se apaga la lista completa de «Cargar lista», y al revés.
  Sin esa regla quedaban dos tablas apiladas en la misma tarjeta — el problema de los dos
  apartados otra vez, sólo que escondido.

### La RPC, simplificada

`ux_vinc_pc_usuario` es **UNIQUE (pc_codigo, usuario)**: dentro de una oficina no hay usuarios
repetidos, así que el `distinct on (lower(btrim(usuario)))` de la primera versión sólo forzaba a
ordenar todo el conjunto sin necesidad. Se sacó, y el orden pasa a `id desc`, que tiene índice
propio (`ix_vinc_pc_id_desc`).

### Prueba

`tests/panel-arranque.test.cjs` reproduce la carrera: dispara dos búsquedas, deja la primera
colgada, resuelve la segunda, y recién entonces resuelve la primera. Verifica que la respuesta
vieja **no** pise a la nueva y que no quede «Buscando…». Para eso `arrancarPanel` acepta un
cliente de Supabase falso, que hay que dejar puesto **antes** de cargar los bundles: `supabaseClient`
es un `const` que se arma con `window.supabase.createClient` al cargar, y no se puede pisar después.

---

## D-42 · El test de arranque cargaba de menos (otra vez)

D-40 dejó `tests/panel-arranque.test.cjs` cargando `js-modules.js` + `js-core.js`. Al probar el
CRM nuevo, el test dijo «falta `crmRegistradosCargar`». **No faltaba**: el CRM vive en
`js-jugadores-crm.js`, que el arnés no cargaba. Es el mismo error que en D-40, donde faltaba
`js-modules.js` y `normalizar()` tiraba `NodoDomain is not defined`.

Dos veces el mismo problema es un problema de diseño del test, no un descuido. Ahora el arnés
**lee el orden de los `<script>` del HTML generado** y carga los 26 bundles en ese orden. Si
mañana se agrega uno, el test lo toma solo.

Suite: 73/73.
---

## D-43 · La lista no decía por qué aparecía cada jugador

Juan: *«y ahora que hipotéticamente se ve una lista de usuarios, estaría bueno —y me juego las
pelotas que no hiciste— mostrar la razón por la cual aparecen en la propia lista»*. No lo había
hecho.

El badge de motivo ya existía: se hizo en **D-31** para la otra tabla del CRM, la que arma
`panel_crm_perfil_v1`. La lista nueva de `panel_crm_vinculos_listar` no devolvía motivo, así que
salía sin él.

**Por qué importa**: buscás un teléfono, aparece un usuario cuyo nombre no se parece en nada, y
no hay forma de saber si entró por el teléfono, por el titular, o si es ruido. Con `limit 10` eso
es peor todavía, porque no ves el resto para deducirlo.

### Qué se hizo

La RPC devuelve `motivo` por fila:

| Motivo | Cuándo |
|---|---|
| `exacto` | el usuario es **igual** a lo buscado |
| `usuario` | el nombre de usuario contiene lo buscado |
| `telefono` | mismo teléfono, comparando los **últimos 10 dígitos** (D-29) |
| `titular` | el titular contiene lo buscado |
| `reciente` | sin búsqueda: son las últimas altas de la oficina |

Y **el orden pasa a ser por fuerza de la coincidencia**, no por fecha: exacto → usuario →
teléfono → titular. Con `limit 10`, si el que buscás queda decimoprimero la búsqueda no sirvió
de nada — es el mismo problema que D-29, donde la RPC cortaba a 100 y el usuario buscado nunca
entraba en el corte.

Probado contra P1:

| Búsqueda | Resultado |
|---|---|
| `pruebaxx` | `pruebaxx [exacto]` |
| `prueba` | `pruebaxx [usuario]` · `vaporprueba [usuario]` |
| `1134970581` | `pruebaxx [telefono]` |
| `Pepe` | cinco usuarios `[usuario]` |

Además la lista dice de entrada **qué está mostrando**: con búsqueda, «Coinciden con «x» ·
ordenadas por qué tan fuerte es la coincidencia»; sin búsqueda, «Últimas altas de tu oficina».
Sin ese encabezado, las primeras 10 filas se leen como si fueran «los jugadores», y no lo son.
---

## D-43b · Corrección: eso no eran motivos, y las páginas hacían falta

Juan sobre D-43: *«las páginas sí tienen que figurar, si no sólo verías desde 10 hasta 100 y
serían siempre los mismos, inútil. Y esos no son motivos: recordá que ahora dibujamos unos pares
de usuarios de onda, deberían de aparecer más arriba por qué…?»*.

Las dos cosas eran ciertas.

### Las páginas

Las había sacado por el pedido anterior («acá no hay pestañas tampoco»), y el desplegable de
cantidad no las reemplaza: con 10..100 se ven siempre los mismos primeros. Una oficina tiene
**6.635 registrados en P1 y 13.759 en P4**; sin avanzar, la lista no sirve para recorrerla.
Vuelven Anterior / Siguiente, y el desplegable pasa a ser el tamaño de página. Cambiar el tamaño
vuelve a la primera, porque la página vieja ya no señala lo mismo.

### «exacto / usuario / teléfono / titular» no son motivos

Son la **mecánica de la búsqueda**. Sirven cuando buscás algo —ahí la pregunta es «por qué
matcheó esta fila»— pero la lista por defecto no tiene búsqueda, así que no explicaban nada:
los diez primeros aparecían porque eran las últimas altas, que no es una razón para atender a
nadie.

Ahora la lista sin búsqueda se ordena por **prioridad operativa**, y el motivo dice qué hacer:

| Motivo | Qué significa | En P4 |
|---|---|---:|
| 🔴 `esperando` | tiene una solicitud abierta **ahora** | 13 |
| 🔁 `sin_operar` | se registró y nunca hizo una operación | 12 |
| 🆕 `alta_nueva` | alta de los últimos 7 días | 35 |
| · `registrado` | el resto, por alta más reciente | — |

Con búsqueda siguen valiendo los de coincidencia, porque ahí la pregunta vuelve a ser otra.

### El costo, que casi lo arruina

La primera forma —un `case` con `not exists` sobre `historial_ops` dentro del `order by`—
tardaba **772 ms** en P4: evaluaba el `not exists` para los 13.759 registrados antes de aplicar
el `limit`. Segundo intento con `left join`: **427 ms**, seguía ordenando todo.

La que quedó arma primero los **conjuntos chicos** (40 solicitudes abiertas, 48 altas de la
semana), les calcula el grupo sólo a ellos, y trae el resto por `ix_vinc_pc_id_desc` con
`limit (offset + limit)`. **261 ms.**

Es la misma lección que D-41b y que el CRM de D-32: el problema nunca fue la cantidad de datos,
fue pedirle a la base que evalúe algo caro sobre todo el conjunto para después tirar el 99 %.
---

## D-44 · Datos de ingreso del jugador · y las claves que no quedaban en ningún lado

Pedido: *«ya tenemos promo, push, cargar, retirar; precisamos uno que le entregue la información
de ingreso a los usuarios: el usuario y su clave, su número de teléfono registrado, para poder
ingresar a la página»*.

### El botón

**🔑 Ingreso** en la ficha del jugador. Abre un cuadro con usuario, clave, teléfono vinculado y
el link de la plataforma, más **📋 Copiar para mandar** y **💬 Mandar por WhatsApp** (al teléfono
vinculado, con el `549` puesto si el número viene de 10 dígitos).

### El problema real: casi nunca sabíamos la clave

La clave no se guarda en ningún lado por diseño. Sólo se puede saber si **se la pusimos
nosotros**. Y de los tres caminos que la cambian, **dos no dejaban rastro**:

| Camino | ¿Quedaba registrada? |
|---|---|
| `_resetClaveManual` (después del alta) | sí, `notas: 'clave → xxxx'` |
| `resetClaveRapido` (chat y perfil) | **no** |
| Alta de usuario | **no** — sólo en `window._altaClaveNueva`, se perdía al cerrar |
| Cambio pedido desde el portal | sí, en `metadata.password_nuevo` |

Medido sobre 3.000 usuarios de P4: **117 con clave recuperable, el 3,9 %**.

Se cerraron los dos agujeros: `resetClaveRapido` y el alta ahora registran la clave igual que
`_resetClaveManual`. De acá en adelante todo cambio de clave queda recuperable; lo viejo no se
puede reconstruir.

### Lo que el botón NO hace

**No inventa una clave.** Si no la sabemos lo dice —*«No sabemos cuál es · nunca se la cambiamos
desde acá»*— y ofrece **🔑 Cambiarle la clave ahora**, que la cambia en el agente, la registra, y
vuelve al cuadro ya con el dato. Ese va a ser el camino normal hasta que se acumule historial.
Sin clave tampoco arma el texto ni muestra el botón de copiar: mandar «Clave: —» es peor que no
mandar nada.

### Nota sobre las claves en la base

Quedan en `historial_ops.notas` en texto plano, que es como ya venía funcionando desde antes
(1.593 filas de 90 días). No es una práctica nueva que se introduzca acá: es la que hace posible
lo que se pidió. Si alguna vez se quiere cambiar, hay que cambiarla en los cuatro caminos a la
vez y aceptar que la clave deje de poder pasarse.

### RPC

`panel_datos_ingreso(p_usuario, p_pc_codigos, p_secret)` — toma la clave **más reciente entre las
dos fuentes** (`RESET_CLAVE` del panel y `CAMBIO_CLAVE` del portal), y devuelve además el teléfono
vinculado, el titular y el host de la oficina.

---

## D-45 · «Cancelar solicitud» no cancelaba nada · RESUELTO

Juan: *«venía diciendo desde el principio: cancelé la carga y NODO jamás se enteró, es más,
volvió a recibir otra»*. Estaba anotado en PENDIENTES desde hace días y no lo había arreglado.

**Lo que pasaba** — el botón hacía sólo esto:

```js
Object.assign(state,{pendingTipo:"",solicitudId:"",chatId:"",...});
["bet300_pending_tipo","bet300_solicitud_id",...].forEach(k=>localStorage.removeItem(k));
```

Limpiaba **el teléfono**. La solicitud seguía viva en `landing_solicitudes`, el operador la veía
igual en la bandeja, y como el portal quedaba libre la persona mandaba otra. En la captura:
**dos CARGA de $5.000 del mismo usuario con dos minutos de diferencia** (#191590 11:57 y
#191592 11:59), las dos «Sin tomar», las dos para procesar.

### Qué se hizo

`landing_cancelar_solicitud(p_solicitud_id, p_usuario, p_public_code, p_chat_token)`, con tres
defensas, las tres probadas contra una solicitud real:

| Intento | Respuesta |
|---|---|
| otro usuario | `{ok:false, motivo:"no_es_tuya"}` |
| id inexistente | `{ok:false, motivo:"no_existe"}` |
| oficina equivocada | `{ok:false, motivo:"otra_oficina"}` |

Y **sólo cancela lo que todavía no tocó nadie**: estado `PENDIENTE` y sin operador asignado. Si
está `EN_REVISION` hay alguien trabajándola —cancelarla desde el teléfono podría dejar plata
cargada sin solicitud—, así que responde `tomada` y el portal manda al chat. Medido en 7 días:
21 `PENDIENTE` sin tomar, 573 `EN_REVISION` todas con operador.

La cancelación queda registrada en el metadata (`cancelada_por: JUGADOR`, cuándo, y el estado
previo), para que no parezca que la solicitud se evaporó.

**El orden importa**: el portal cancela primero en el servidor y **sólo si eso sale bien** limpia
el teléfono. Si falla, el pendiente queda como estaba — dejar el teléfono libre con la solicitud
viva es exactamente lo que generaba las duplicadas.

---

## D-46 · La billetera de la solicitud, del lado del jugador

Complemento de D-39, que resolvió sólo la mitad. Ahí el **operador** pasó a ver cuándo la persona
usó la billetera anterior. Faltaba que lo viera **la persona**, que es la única que sabe adónde
transfirió de verdad.

Ahora la solicitud guarda en el teléfono la billetera que el portal mostraba al enviarla
(`bet300_pending_billetera`), y la pantalla de Estado muestra **«Transferiste a: X»**. Si la
billetera activa ahora es otra, se pinta en ámbar:

> ⚠ En el portal ahora figura **CASTRO**. Tu solicitud queda igual con la de arriba. Si
> transferiste a esta otra, avisanos por el chat.

Probado en los tres casos: misma billetera → lo muestra sin alarma; cambiada → avisa; sin
solicitud previa → no dibuja nada.

---

## D-47 · Los campos de monto aceptaban texto

Eran `type="number"`. **Chrome deja tipear letras igual**: se ven en pantalla pero `value` queda
vacío. La persona veía `prueba` escrito en «MONTO TRANSFERIDO» y el portal leía nada.

Ahora son `type="text" inputmode="numeric"` con filtro de dígitos en cada tecla. De paso se van
las flechitas del spinner, que se montaban encima del texto. Probado:

| Se tipea | Queda |
|---|---|
| `prueba` | *(vacío)* |
| `5.000` | `5000` |
| `12a34` | `1234` |
| `-500` | `500` |
| `1e5` | `15` |
---

## D-48 · La tabla muerta · por qué el cambio de clave no se cerraba nunca

Juan: *«no se va, el hdp, después de cambiar la clave no desaparece»*. La solicitud `#188138`
seguía en la bandeja con «▶ Realizar» después de que la clave se cambiara bien.

### Lo medido

```sql
select id, estado, updated_at from landing_solicitudes where id = 188138;
-- 188138 | PENDIENTE | 2026-09-06 13:52:19   ← la fecha de CREACIÓN
```

`updated_at` nunca se movió: **el update jamás ocurrió**. Y `ejecutarAutoClave` sí lo llamaba:

```js
await actualizarSolicitudSupabase(id, { estado: "APROBADA", operador_usuario: ... });
```

La función escribía acá:

```js
supabaseClient.from("solicitudes").update(cambios).eq("id", id)
```

**`solicitudes` está muerta desde el 30 de mayo.**

| Tabla | Filas | Última |
|---|---:|---|
| `solicitudes` | 156 | 2026-05-30 |
| `landing_solicitudes` | **191.608** | hoy |

El update no matcheaba ninguna fila, `.single()` devolvía error, y el error se iba a
`console.error` — invisible para el operador. La clave se cambiaba de verdad, el jugador recibía
el aviso, y la solicitud quedaba pendiente para siempre.

**Eran 16 llamadores**, no uno: cambios de clave, cargas, retiros, aprobaciones y rechazos en
`automatizaciones.js` y `lotes-y-solicitudes.js`. Se redirigió la función entera a la RPC que usa
el resto del panel (`panel_v15_5_actualizar_solicitud_portal`) en vez de tocar los 16: la firma no
cambia y `estado` / `operador_usuario` / `monto` se mapean a sus parámetros; lo que sobra viaja
como metadata.

### Tirando del hilo: tres usos más de la tabla muerta

**Dos retiros que no quedaban registrados en ningún lado vivo.** El retiro rápido del chat
(`retirarSaldoRapido`) y el del panel de agentes insertaban en `solicitudes` «para validar la
política de 24 hs», y **ninguno de los dos** llamaba a `registrarEnHistorial`. O sea: salía la
plata y no quedaba rastro en el sistema vivo. Peor: como la regla de 24 h mira `historial_ops`,
esos retiros eran **invisibles para ella** — se podía sacar por ahí y volver a sacar por el
portal el mismo día. Ahora los dos escriben en `historial_ops`.

**La fuente 1 del chequeo de 24 h leía la tabla muerta.** El chequeo tiene tres fuentes; la 1
(«retiros cerrados desde el panel de solicitudes o chat») apuntaba a `solicitudes` y no devolvía
nunca nada. La regla igual funcionaba por la fuente 2 (`historial_ops`), pero un retiro del portal
sin fila en el historial se colaba. Ahora la 1 lee `landing_solicitudes`.

**`cargarSolicitudesSupabase()`** también lee la tabla muerta, pero es el camino viejo: cuando el
puente del portal está arriba, `cargarSolicitudes` delega en `v154pCargarSolicitudes` y esto no se
usa. Queda anotado, no tocado.

### La lección

El error existía y estaba escrito: `console.error("Error actualizando solicitud:", error)`. Nadie
lo ve nunca. Un `console.error` en un flujo que el operador dispara a mano es lo mismo que no
tener nada — la operación «funciona», la pantalla no cambia, y el que está adelante piensa que la
app se colgó.

Suite: 86/86.
---

## D-49 · Media hora cambiándole la clave al mismo jugador

Juan: *«hace más de media hora sigue reintentando cambiar la clave, lo hace, eso es lo peor»*. En
la captura, el cartel *«Cambiando la clave en 11s»* corriendo **mientras abajo dice «No hay
solicitudes Portal pendientes»**.

### La causa

En `_claveAutoTick`, el filtro de solicitudes ya cerradas:

```js
if(typeof estadoCerrado==='function' && estadoCerrado(s.ESTADO)) return false;
```

**`estadoCerrado` no existe en el ámbito del panel.** Vive dentro del módulo del portal
(`renderer/portal/data.js`) y sólo se alcanza como `deps.estadoCerrado`. Verificado corriendo el
bundle entero en un `vm`:

```
typeof estadoCerrado en el panel: undefined
```

Como estaba escrito con la guarda `typeof … === 'function' &&`, la condición era **siempre falsa**
y el filtro **nunca corrió**. Una solicitud de cambio de clave ya aprobada seguía en la lista, el
ciclo le rearmaba la cuenta de 25 s, y le volvía a cambiar la clave. Cada 25 segundos, media hora.

La guarda defensiva —puesta para que no rompiera si la función no estaba— convirtió un error
ruidoso en uno silencioso que hacía la operación de nuevo.

Y encadenaba con **D-48**: mientras el update iba a la tabla muerta, el estado nunca pasaba a
`APROBADA`, así que aunque el filtro hubiera funcionado tampoco habría cortado. Dos fallas
distintas que se tapaban entre sí.

El mismo `typeof` roto estaba en `chunior-recuperacion-y-transferencias.js:53`.

### Qué se hizo

1. **`_estadoYaCerrado(e)` en el ámbito del panel**, sin depender del módulo del portal. Cubre
   `APROBADA`, `APROBADA_MANUAL`, `RECHAZADA`, `CANCELADA`, `ACREDITADA`, `PAGADA`, `OK`,
   `COMPLETADA`, `REVERTIDA`, `CERRADA`/`CERRADO`, `FINALIZADA`.
2. **`window._clavesHechas`** — una solicitud ejecutada no se vuelve a ejecutar en esta sesión,
   **pase lo que pase con el estado**. Se marca **antes** de ejecutar, no después: si el cambio
   tarda y el tick vuelve a correr, no puede agarrarla de nuevo. Y si falla, tampoco se reintenta
   sola: para eso está el botón «Realizar». Reintentar solo un cambio de clave que quizá ya se
   hizo es peor que no reintentarlo.

Si mañana el update a la base vuelve a fallar, el peor caso pasa a ser una solicitud que queda en
la bandeja — no setenta cambios de clave.
---

## D-50 · Sonda de sesión: enterarse antes de que lo descubra una carga

Idea de Juan: *«hay oficinas en las cuales literalmente se está cerrando la sesión de agentes —
NODO obviamente lo detecta cuando va a realizar una carga, que es el momento en que te avisa—.
Deberías generar un usuario de prueba y cambiar la contraseña si pasan más de 6 minutos sin
cargas, refrescando automáticamente el panel»*.

El problema es real y el momento del descubrimiento es el peor posible: con un cliente esperando
y la plata ya transferida.

### Cómo quedó

Cada minuto se fija: si pasaron **más de 6 minutos** sin ninguna operación real contra el agente
**y** no hay nada en curso, hace una operación de prueba. Si la sesión murió, salta el mismo
cortacircuitos de siempre (`_drexMarcarSinSesion`) y aparece el login — pero con el mostrador
vacío. Si está viva, refresca el panel en silencio.

El reloj no es un contador aparte: `callDrex` es el punto único por el que pasa todo, y ahí se
marca `_drexUltimaOpOk` cada vez que una operación real vuelve sin pedir login. Mientras se opera,
la sonda no hace nada.

Guardas: no sondea si el agente está ocupado (meterse en medio de una carga es peor que esperar),
ni si el login ya está en pantalla, ni fuera de la app de escritorio.

### Un cambio sobre lo pedido, y por qué

**No cambia la clave de un usuario de prueba: hace `buscarUsuario`.**

`buscarUsuario` es la **primera parte de toda carga**. Si la sesión murió, falla exactamente
igual que fallaría la carga, así que detecta el mismo problema. La diferencia es que no escribe
nada. Cambiar una clave cada 6 minutos son ~240 escrituras por día en el sistema de juego sin
ninguna necesidad, y si ese usuario alguna vez resulta ser de alguien real, lo deja afuera de su
cuenta. Mismo diagnóstico, cero efecto.

### Configuración

`sondaSesionUsuario('elusuario')` desde la consola del panel guarda el usuario de prueba de esa
oficina. **Sin uno configurado** la sonda cae a `ensureDrexSession()`, que navega y muestra el
login si hace falta: detecta menos casos —no prueba una operación real— pero no queda a ciegas.
Conviene cargar uno por oficina.

Los umbrales están en `SONDA_MINUTOS` (6) y `SONDA_CADA_MS` (60 s).

---

## D-51 · La carga manual no le llegaba nunca al jugador

Juan: *«si el usuario cancela la operación para nosotros es instantáneo, ¿por qué no se sube la
carga manual de manera instantánea al usuario?»*.

**Porque la carga manual no genera solicitud.** El operador la hace desde «Operación manual
automatizada» y eso escribe **sólo** en `historial_ops`. El historial del portal leía **sólo**
`landing_solicitudes`. Nunca se cruzaban: la plata le entraba al jugador y en su portal no
aparecía nada.

Medido en 7 días:

| | Filas | Sin solicitud | Invisibles | Jugadores |
|---|---:|---:|---:|---:|
| CARGA | 19.986 | 959 | **4,8 %** | 377 |
| RETIRO | 1.362 | 115 | **8,4 %** | 85 |

**1.074 operaciones y 462 jugadores** que movieron plata y no vieron nada.

### Qué se hizo

`landing_historial_usuario` ahora une las dos fuentes. Tres cuidados:

**Quién puede verlas.** Una fila de `historial_ops` no tiene teléfono, así que no se puede
comparar como con las del portal. La pertenencia se verifica contra `usuarios_portal_vinculos`:
ese usuario tiene que estar vinculado a **ese** teléfono en **esa** oficina. Sin eso, cualquiera
que adivine un nombre de usuario vería sus operaciones. Verificado: con el teléfono correcto ve
1 manual + 9 del portal; con un teléfono ajeno o desde otra oficina, **cero**.

**Sin duplicados.** Las que sí nacieron de una solicitud ya vienen por el otro lado, así que se
excluyen por `solicitud_id`.

**Sólo las que movieron plata.** La primera versión mostraba también los intentos en `ERROR` — en
la prueba salían tres CARGA de $20.000 fallidas al lado de la que sí entró, o sea que parecía que
le habían cargado 80.000. Ahora sólo entran `OK`/`ACREDITADA`/`PAGADA`/`COMPLETADA`/`APROBADA`.

### Y que aparezca sola

El historial se pintaba **una sola vez**, al entrar a la pantalla. Una carga de mostrador iba a
aparecer recién cuando la persona saliera y volviera a entrar — o sea nunca, porque no tiene
motivo para hacerlo. Ahora, mientras esté mirando el Estado, se relee cada 15 s (y no consulta si
la pestaña está en segundo plano).

Cada fila dice de dónde salió: **«Te la cargamos nosotros»** para las de mostrador. Sin eso, una
carga que la persona no pidió por el portal parece una solicitud suya que no recuerda haber
mandado.

---

## D-52 · El aviso de billetera vieja no llegaba donde se decide

Juan probó el caso exacto: *«en la misma sesión cambié la billetera y subí la solicitud sin
recargar la página. NODO no muestra que la billetera está incorrecta hasta que desplegás la
carga, y tampoco lo destaca»*.

El aviso existía desde **D-39**, pero sólo en el Centro de Solicitudes. La tarjeta de
**«Solicitudes pendientes» del Inicio** —que es la que el operador mira— la dibuja otro código
(`renderer/portal/requests-view.js`), y el **modal de aprobar** otro más. En ninguno de los dos
aparecía.

### Por qué no aparecía aunque la función estuviera

`_billeteraVieja` leía sólo la forma del historial unificado: `it.pendiente`, `it.tipo`,
`it.billetera_nombre`, `it.billetera_id` — todo en minúscula. Pero la tarjeta del Inicio y el
modal trabajan con la **solicitud cruda del portal**, que viene en MAYÚSCULAS: `s.TIPO`,
`s.ESTADO`, `s.BILLETERA_NOMBRE`, `s.ID_BILLETERA`. La función recibía el objeto, no encontraba
nada de lo que buscaba, y devolvía `null` sin quejarse.

Ahora entiende las dos formas y deduce «abierta» del estado cuando no viene el flag `pendiente`.
Verificado contra el bundle real, con BANCO como billetera activa:

| Caso | Resultado |
|---|---|
| solicitud cruda del Inicio (el caso de Juan) | ⚠ SALVATIERRA X → BANCO |
| cruda, con la billetera activa | sin aviso |
| cruda ya acreditada | sin aviso |
| cruda de RETIRO | sin aviso |
| item del historial unificado | ⚠ SALVATIERRA X → BANCO |
| cruda sin `ID_BILLETERA`, sólo nombre | ⚠ SALVATIERRA X → BANCO |

### Dónde se ve ahora

- **Tarjeta del Inicio**: borde ámbar, franja lateral, y arriba del todo
  **«⚠ Transfirió a SALVATIERRA X · ahora BANCO»**. Sin desplegar nada.
- **Modal de aprobar**: un bloque ámbar arriba de los datos —
  *«⚠ No refrescó el portal. Transfirió a SALVATIERRA X, pero la billetera activa ahora es BANCO.
  Revisá en cuál entró la plata antes de aprobar.»* Es el último punto antes de acreditar.
- **Centro de Solicitudes y ficha**: como estaban desde D-39.

La lección se repite: una función que devuelve `null` en silencio cuando no entiende su entrada
es indistinguible de «no hay nada que avisar».

---

## D-53 · «Ya se la cargué»: el rechazo que no era un rechazo

Medido en 30 días, sobre 2.900 rechazos de CARGA:

| Motivo | Veces | Jugadores | Terminaron cargando en 6 h |
|---|---:|---:|---:|
| No nos llegó tu transferencia | **1.718** | 892 | 64,4 % |
| No pudimos procesar (genérico) | 597 | 353 | 56,6 % |
| Comprobante repetido / ya usado | 390 | 281 | 47,2 % |
| **«Ya fue cargado»** (6 redacciones) | **124** | ~110 | 49,2 % |
| Otro | 189 | 118 | 62,4 % |
| Titular no coincide | 69 | 33 | 63,8 % |

Los 124 son `CARGADO`, `YA FUE CARGADO`, `FICHAS CARGADAS`, `YA SE TE CARGO`, `CARGADAS`,
`FUE CARGADO RECIEN`: seis formas de escribir lo mismo a mano. **Eso no es un rechazo.** El
operador ya le cargó las fichas por otro lado y usa «Rechazar» para sacar la solicitud de la
bandeja. El jugador queda viendo **«Rechazada»** en rojo con la plata adentro, y el motivo suena
a que hizo algo mal.

**`v154pYaCargada(id)`** la cierra como **ACREDITADA** —que es lo que pasó—, con
`cerrada_como: YA_CARGADA` en el metadata, y le avisa en consecuencia: *«Tu carga de $X ya está
acreditada. Revisá tu saldo.»* No carga nada: sólo cierra la solicitud.

Vive **sólo adentro del modal de rechazo** —*«¿Ya se la cargaste por otro lado?»*—, que es
donde el operador se da cuenta. Estuvo un rato también como botón en la tarjeta del Inicio y se
sacó: esa tarjeta ya tiene Tomar / Aprobar / Ver / Rechazar, y esto son 124 casos en 30 días.
No merece un lugar fijo ahí.

### El resto de los motivos, para cuando sigamos

- **«No nos llegó» es el 59 %** y un tercio (611 de 1.718) nunca vuelve a cargar. Ahí está la
  plata que se pierde.
- **El titular es el 2,4 %** — 69 casos, 33 jugadores, y el 63,8 % igual termina cargando. Vale
  arreglarlo, pero no es por donde empezar.
- **Los motivos son texto libre**, y por eso hay seis formas de «ya se cargó». Sin una lista
  cerrada, el portal no puede saber qué acción ofrecer para cada rechazo.

---

## D-54 · Dos avisos que mentían

**El badge «esperando» del CRM.** Marcaba como «tiene una solicitud abierta ahora» a jugadores
cuya única solicitud abierta era un **ticket de SOPORTE de hace dos meses**. El operador veía el
badge rojo, iba a la bandeja y no había nada. Faltaban dos filtros: sólo `CARGA`/`RETIRO`, y sólo
de las últimas 24 h. Verificado sobre los cinco de la captura: los cinco dejaron de decirlo.

**El 🔍 de la fila de cambio de clave.** Abría «Detalle del movimiento» y mostraba
*«⬆️ Carga · pruebaxx · $ 0»* con el árbol de OTRAS operaciones colgando abajo. Es el mismo
molde de carga/retiro aplicado a algo que no mueve plata (igual que D-38 con el expediente).
Ahora el botón no aparece en los tipos sin movimiento, y si algo lo llama igual, lo dice en vez
de inventar una carga.

---

## D-55 · «Discrepancia» pasa a llamarse diferencia, y se explica

Juan: *«la discrepancia la llamamos diferencia»*, y *«al lado del botón rechequear fichas quiero
un botón de info cuando haya diferencia»*.

**El renombre.** 25 apariciones en 7 archivos, adentro y afuera: los banners del watchdog, el
estado de la tarjeta de fichas, y también los identificadores —`portalCheckDiscrepancia` →
`portalCheckDiferencia`, `portalJobDiscrepancia` → `portalJobDiferencia`— con su entrada en el
contrato de dependencias y el getter del bridge. No quedó ninguna.

**El botón ℹ Dife.** Al lado de ↻ Rechequear, y **aparece sólo cuando hay diferencia**: un botón
que está siempre se vuelve parte del decorado y nadie lo toca el día que hace falta.

Lo que explica, que es lo que el número solo no dice:

- **Para qué lado.** `+` es *sobran fichas en el casino* —se cargó algo que en Chunior no quedó
  anotado—; `−` es *faltan* —hay anotado de más, típicamente un retiro anotado dos veces—. El
  signo es lo que nadie tiene memorizado.
- **Qué hacer, en orden.** Rechequear primero (si venís de operar, puede ser un movimiento que
  todavía no impactó) → buscar en el historial del turno **una operación por ese monto exacto**,
  porque casi siempre la dife es una sola → corregirla donde falte → y si no aparece, dejarla
  anotada en el cierre de turno. Una dife sin explicar que pasa de turno no la resuelve nadie.
- **Cuándo está cuadrado**, lo dice y no le da una lista de tareas al pedo.

**Pendiente, por decisión de Juan:** el botón que muestre los movimientos del turno que dan ese
monto, en un desplegable aparte cargado sólo al abrirlo. Falta decidir de dónde salen — de
`historial_ops` (lo que anotamos nosotros) o de los movimientos reales de Chunior. Lo segundo es
lo útil para cotejar, pero implica leer de Chunior con la ventana ocupada unos segundos.

**Idea de fondo anotada, sin implementar:** integrar el cotejo dentro del apartado de billeteras
en vez de tenerlo como sistema aparte. En palabras de Juan: *«agregá el monto real si tenés dife,
agregalo en todas las billeteras, el sistema verifica»*. Convierte algo que hay que entender en
un campo al lado del saldo.

---

## D-56 · Bloquear un titular no salía de esa PC

Juan: *«acabo de bloquear ese titular, ¿por qué no se ve reflejado en la página?»*.

Porque el bloqueo se guardaba acá:

```js
function _rechSave(m){ localStorage.setItem(_RECH_KEY, JSON.stringify(m)); }
```

**El `localStorage` de esa PC.** No hay ninguna tabla: lo verifiqué, no existe nada parecido a
`titulares_bloqueados` en la base. Consecuencias, todas reales:

- **El portal no se entera nunca.** Es otro origen y otra máquina: le seguía ofreciendo al
  jugador el titular prellenado que acabábamos de bloquear.
- **Otro operador en otra PC tampoco lo ve.** Cada máquina conoce sólo los que bloqueó ella.
- **Si se limpian los datos del navegador, el bloqueo desaparece.**
- Había un **tope de 500** y el más viejo se borraba solo, sin avisar.

O sea que bloquear un titular sólo servía para el auto-rechazo **de esa PC, en ese perfil**.

### Qué se hizo

**Tabla `titulares_bloqueados`** (`pc_codigo`, `usuario` —con `'*'` = todas las cuentas de la
oficina—, `titular_norm`, `titular`, `motivo`, `operador`), con índice único por oficina + usuario
+ titular normalizado.

**La normalización es compartida.** `nodo_norm_titular()` en la base hace lo mismo que
`_normNombre()` en el panel: minúsculas, sin acentos, lo que no es alfanumérico pasa a un espacio,
trim. Si las dos no coinciden, el bloqueo no matchea y no sirve para nada. Probado: `pepep eeedcf`
y `  PEPEP   EEEDCF ` dan el mismo resultado.

**Cuatro RPCs:** una que usa el portal (`landing_titular_bloqueado`, sin secreto: es un sí/no
sobre un dato que la persona ya tiene delante), y tres del panel para bloquear, desbloquear y
listar.

**El panel escribe en la base y mantiene el local como caché**, para que la pantalla reaccione al
instante sin esperar la red. Si la escritura falla, avisa que el bloqueo quedó sólo en esa PC.
Y al resolver la oficina en el login, **trae los bloqueos de las otras PCs**.

**El portal pregunta antes de crear la solicitud**, no después: rechazarla después es hacerle
perder el viaje a la persona y sumar un rechazo más a la pila. Si está bloqueado, marca el campo
y explica qué hacer.

Verificado contra la base con el caso de Juan: bloqueado para `pruebaxx` da `true`; el mismo
titular para otro usuario, `false`; desde otra oficina, `false`.

### Lo que queda por decidir

El bloqueo es **por oficina**. Un titular que se usa para estafar en P1 sigue habilitado en P4.
Hacerlo global entre oficinas es una decisión de negocio, no técnica — queda anotado.

---

## D-57 · El portal dejaba mandar otra solicitud con una abierta

Juan, probando: *«sigo pudiendo realizar otra carga mientras la anterior sigue en revisión, y no
destaca que se volvió a abrir la instancia»*. En la captura, el Estado decía **«No tenés
solicitudes activas»** mientras el historial mostraba una carga **En revisión** de esa mañana.

**Por qué.** El portal sabía si había una solicitud abierta **sólo por su propio localStorage**.
Esa marca se pierde de cuatro formas, todas normales:

- la canceló (y hasta D-45 eso ni siquiera cancelaba del lado nuestro);
- limpió los datos del navegador;
- entró desde otro teléfono;
- **el operador rescató una rechazada y la volvió a abrir** — el caso de Juan.

Medido: **12.067 solicitudes en 30 días llegan a menos de 15 minutos de la anterior del mismo
jugador** (13,9 % de 87.082, 1.809 jugadores). Cada una es trabajo duplicado.

**`landing_solicitud_activa`** responde desde el servidor, que es el único que sabe la verdad:
devuelve la solicitud abierta (`PENDIENTE`/`EN_REVISION`/`EN_PROCESO`, de las últimas 24 h) con
su tipo, monto, billetera y un flag **`reabierta`**.

Se usa en dos momentos:

- **Al entrar al Estado**, para dejar el portal como corresponde. Corrige los dos sentidos: si el
  teléfono creía que no había nada y el operador reabrió una, la muestra; si creía que había una
  que ya se resolvió, limpia la marca vieja sin molestar con carteles.
- **Justo antes de crear una solicitud** (`_puedeOperarConServidor`), que es el único momento en
  que vale la pena esperar una consulta más.

Una solicitud de más de 24 h no traba a nadie: eso no está «activa», está colgada, y es otro
problema (§10 de SISTEMA_ENLACE).

**Cuando la reabrieron, se dice.** Aviso propio arriba del estado: *«Volvimos a abrir esta
solicitud. Se había rechazado y la estamos revisando de nuevo. **No mandes otra:** es la misma.»*
Sin eso, la persona ve una rechazada en el historial y una activa arriba, y no entiende que son
la misma.

---

## D-58 · El portal aceptaba NUESTROS datos como titular

Se podía escribir «Paola Salvatierra» —el titular de nuestra billetera— en el campo «¿a nombre de
quién está la cuenta que usaste?». El portal lo dejaba pasar, la solicitud llegaba, y recién ahí
el auto-rechazo `DATO_PROPIO` la frenaba. El jugador pierde el viaje y el operador el tiempo.

Los datos de la billetera están **en el portal, a la vista de la persona**, así que se corta
antes de mandar. Compara contra titular, alias, CBU/CVU y el nombre interno, normalizando (sin
espacios ni puntuación, minúsculas). Probado:

| Lo que pone | Resultado |
|---|---|
| `Paola Salvatierra` | rechaza |
| `paola.111.olmo.mp` | rechaza |
| `SALVATIERRA X` | rechaza |
| `0000003100012345678901` | rechaza |
| `paola salvatierra` | rechaza |
| `Juan Perez` | acepta |
| `pepep eeedcf` | acepta |

El mensaje dice qué poner, no sólo que está mal: *«Ese es el titular de NUESTRA cuenta, no el
tuyo. Poné el nombre completo del titular de la cuenta desde la que transferiste.»*

---

## D-59 · «15 operaciones en el turno» con una carga por día en la lista

Juan: *«fijate por qué esas 15 operaciones… estás viendo que hay una carga cada día,
literalmente, en la misma vista»*. El KPI decía **15 cargas aprobadas · En el turno seleccionado**
y la lista de al lado mostraba 9/9, 9/9, 7/9, 7/9.

**Los dos tenían razón.** El clasificador de turnos miraba **sólo la hora**:

```js
function _obtenerTurnoDeFecha(ts){
  const d = new Date(new Date(ts).getTime() - 3*3600*1000);
  const h = d.getUTCHours();
  if(h >= 6 && h < 14) return 'TM';
  ...
}
```

Devuelve `TM` para las 07:30 **de hoy, de ayer y de la semana pasada**. Así que «turno actual»
significaba en realidad «esa franja horaria, de cualquier día que esté cargado». El KPI contaba
todo eso; la lista, ordenada por fecha, dejaba ver que eran de días distintos.

Encima, el filtro incluía las filas **sin fecha** (`if(!x.fecha) return true`), que sumaban al
total sin pertenecer a ningún turno.

### Qué se hizo

Un turno es un **bloque de un día concreto**, no una franja. `_bordesTurno(turno)` calcula sus
límites reales en hora argentina y `_enTurno(fecha, turno)` responde si una fecha cae adentro.

El caso que había que resolver bien es **TN, que cruza la medianoche**: a la 01:00 el turno noche
en curso empezó **ayer** a las 22:00. Y si el operador elige un turno que hoy todavía no arrancó,
se toma el de ayer — que es el último que existió.

Verificado: un turno dura exactamente 8 h; las 07:30 de ayer **no** son del TM de hoy; las 15:00
no son TM; una fila sin fecha no cuenta; TN empieza a las 22:00 AR y dura 8 h sin partirse.

---

## D-60 · Billeteras cruzadas entre oficinas · plata al saldo equivocado

Juan: *«se están cruzando datos de billes por ofi»*. En P4, con **GIORDANO** marcada EN PORTAL,
el aviso decía *«Transfirió a GIORDANO · ahora AVILA MP»*.

Contra la base:

| Billetera | Oficina | EN PORTAL |
|---|---|---|
| GIORDANO, CASTRO, MATRELO, PROMOS | **P4** | GIORDANO |
| **AVILA MP** | **P2** | AVILA MP |

`billeteras` tenía filas de **las dos oficinas** al mismo tiempo, y `getBilleraLanding()` hacía
`.find(SELECCIONADA_MANUAL==='SI')` **sin filtrar por oficina**: con las dos mezcladas devolvía la
primera del array, que era la de P2.

**No es cosmético.** Esa función se usa en **17 lugares**, y entre ellos los que ajustan el saldo
de la billetera después de una carga (`automatizaciones.js:642`, `lotes-y-solicitudes.js:465`).
Una carga en P4 podía **descontarle el saldo a P2**.

### De dónde salía la mezcla

El tercer fallback de `cargarBilleteras` busca por los UID de wallet detectados en la ventana de
Chunior:

```js
.from('billeteras').select('*').in('chunior_uid', uids)
```

**Sin filtro de oficina.** La misma wallet puede existir en varias oficinas, así que traía las
ajenas y las mezclaba con las propias.

### Tres cierres, no uno

1. **`getBilleraLanding()` filtra por la oficina actual.** Es la red que cubre los 17 usos de una
   sola vez. Si no hay oficina resuelta todavía, no filtra —si no, el panel arrancaría sin
   billeteras—; y una fila sin `pc_codigo` se deja pasar, porque no se puede afirmar que sea ajena.
2. **El fallback por `chunior_uid` filtra por `pc_codigo`.**
3. **Red final al armar `billeteras`:** venga del camino que venga, una fila de otra oficina no
   entra, y si se descarta alguna queda avisado en consola con el conteo.

---

## D-61 · Un retiro parcial de $500.000 que salió y no quedó registrado

La traza mostraba todo en verde hasta el final: fichas extraídas, `Registrado en Chunior
(N° 9631137)`, `Billetera GIORDANO debitada ($500.000)`. Y después nada — el modal congelado con
el botón «Cancelar».

Contra la base:

- `landing_solicitudes` **#198680**: `PENDIENTE`, sin `retiro_parcial`, sin pagos, `updated_at`
  igual a la fecha de creación. **Intacta.**
- `historial_ops` para ese usuario: **cero filas**.

La plata salió y no quedó registrada en ningún lado.

### Por qué

`_rv2Finalizar` —que registra el historial, avisa al jugador y cierra la solicitud— se llama desde
**dos lugares**:

```js
// línea 296
try{ await deps._rv2Finalizar(); }catch(e){ ...avisa... }

// línea 222  ← el camino que se usó
await deps._rv2Finalizar();
```

El segundo **no tenía try/catch**. Una excepción ahí se pierde en un unhandled rejection: sin
toast, sin alerta, la traza congelada en el último paso que sí funcionó. Y arriba de todo,
`_rv2Finalizar` abre con `if(!st) return;` — un **return silencioso después de haber movido la
plata**.

### Qué se hizo

No sé cuál de las dos ramas se disparó —para eso hace falta la consola del momento—, así que se
cerraron las tres formas de que esto vuelva a pasar **sin dejar rastro**:

1. **La llamada de la línea 222 tiene try/catch**, con el mismo aviso que la otra: traza en rojo,
   toast y alerta diciendo que la plata salió y la solicitud quedó con el estado viejo.
2. **El `return` silencioso avisa.** Si se perdió el estado del retiro justo antes de cerrarlo, lo
   dice en vez de irse callado.
3. **Perder la fila del historial deja de ser silencioso.** El `catch(_e){}` alrededor de
   `registrarEnHistorial` no decía nada: sin esa fila la operación no existe para el cotejo, para
   la regla de 24 h ni para el jugador.

Y se agregó un paso de traza al entrar al cierre, para que la próxima vez se vea si llegó o no.

**La #198680 hay que cerrarla a mano**: son $500.000 pagados que la solicitud no refleja.

---

## D-62 · Dos operaciones distintas con el MISMO N° de Chunior

Mirando las trazas de los dos intentos de retiro de herlan:

```
intento 1:  Registrado en Chunior (N° 9631137 · GIORDANO)   $ 500.000
intento 2:  Registrado en Chunior (N° 9631137 · CASTRO)     $ 1
```

**El mismo número, distinta billetera, distinto monto.** Y `9631137` no existe en `historial_ops`
—porque el cierre nunca corrió (D-61)—, así que el número salió del scraper, no de la base.

### Por qué

Después de enviar el formulario, el panel espera a que aparezca un cartel de éxito y le saca el
número:

```js
var ok = document.querySelector("li.success") || document.querySelector(".messagelist .success") ...
```

**Nunca verifica que el cartel sea NUEVO.** Si la navegación no ocurrió —validación, lentitud,
sesión caída, el click que no llegó a enviar— el cartel de la operación **anterior** sigue en la
página, el poll lo encuentra al instante y devuelve **su** número.

Es peor que un dato equivocado: un N° repetido rompe el cotejo (dos operaciones apuntando al
mismo movimiento) y **tapa una operación que quizás nunca se registró en Chunior**. El operador ve
el tilde verde y se queda tranquilo.

### Qué se hizo

Antes de hacer click, se **borran de la página los carteles de éxito que ya estén**. Así,
cualquier `.success` que aparezca después es necesariamente de esta operación. Va en los **ocho**
envíos que parsean número: cargas, retiros, propinas, depósitos sin reclamar, transferencias y
anulaciones.

Verificado que el snippet inyectado parsea como JS y que efectivamente remueve los carteles.

**Queda pendiente comprobar en Chunior** si el retiro de $1 quedó anotado con otro número o si no
se anotó: desde acá no se puede saber, porque la fila nunca llegó a `historial_ops`.


# RELEVAMIENTO DEL 2026-09-11

Hallazgos abiertos salvo donde diga lo contrario. Sin nombres de jugadores ni de operadores a
propósito: este archivo está en un repositorio público (ver D-63).

## D-63 · Las claves del panel están publicadas en repos públicos · URGENTE

`PANEL_DATA_SECRET` ("la clave de datos del panel") y `PUSH_SECRET` están escritos en el código
—`renderer/core/configuracion-y-estado.js`, `services/worker-bootstrap.js`, `SQL_cotejo_casos.sql`—
y ese código está publicado:

- `NexoBetaChan`: en la rama `integracion` y en el historial desde el 2026-09-06.
- `nodo-panel`: en 8 commits del historial. La punta de `main` ya no lo trae.
- La clave de push está en la **punta de `main` de los dos**, no sólo en el historial.

Probado contra Supabase: la clave de datos es la que está en uso y se exige
(`panel_blindaje.crm_secret.exigir = true`). **Abre 44 funciones**, entre ellas las de
credenciales de backoffice, datos de acceso de jugadores y alta y selección de billeteras —
o sea, hay un camino directo a desviar cargas.

**El detalle de cuáles son y qué permite cada una NO se escribe acá**: este archivo está en un
repositorio público y la clave todavía es válida, así que enumerarlas sería publicar el mapa al
lado de la llave. El listado completo se pasa por canal privado.

Revisado el 2026-09-10: las 7 billeteras en portal eran las legítimas y no hay llamadas desde IPs
ajenas en los logs (todo sale de las oficinas y sus proxies). **No hay señal de uso, pero el
registro de uso no cubre esas funciones** (validan con `_panel_data_auth`, que no registra).

**Plan propuesto, pendiente de decisión:** Supabase acepta la vieja y la nueva durante la
transición → sale una release que ya no la trae en el código → se carga en cada PC → se da de
baja la vieja. Rotar vuelve inofensivo el historial: no hace falta reescribir nada.

Aparte: este mismo archivo tiene teléfonos, usuarios de jugadores y titulares, y está publicado.

## D-64 · "Cerrar el retiro" no tiene candado: 11 filas para un solo pago

Solicitud **84401** (P2, 2026-08-08): pidió $756.400, y contra ella hay **12 movimientos por
$5.700.000**. Mirados uno por uno: el primero es un parcial legítimo de $200.000, y los otros
**once son de $500.000 desde la misma billetera, en 20 segundos**, con intervalos de 46 ms, 8 ms,
1 ms y 0 ms. Eso no lo hace una persona: es el botón apretado a repetición.

Las once tienen `chunior_movimiento_id = null` → **ninguna se anotó en Chunior**, así que la
transferencia real fue una sola. Se duplicó el registro, no la plata.

### Por qué

`renderer/portal/withdrawals-execution.js:258` dibuja
`<button onclick="_rv2Finalizar()">Cerrar el retiro</button>` y `_rv2Finalizar` (línea 315) **no
tiene guarda de reentrada**: cada clic escribe una fila en `historial_ops` y notifica de nuevo.
El camino normal sí cierra el modal enseguida (línea 134), pero este botón no.

### Qué falta

Bloquear el botón al primer clic y una guarda de reentrada en `_rv2Finalizar`. **Sin verificar:**
si cada clic además ajustó el saldo de la billetera, esa billetera quedó descontada $5.500.000 de
más. No se puede comprobar por `billetera_movimientos` porque esa tabla arrancó después.

## D-65 · El portal acepta montos absurdos

11 solicitudes donde el monto pedido y el monto real difieren por factor 10, 25 o 100:

| Solicitud | Oficina | Entró como | Era |
|---|---|---|---|
| 71213 | P2 | $80.000.000 | $800.000 |
| 162329 | P2 | $65.000.000 | $650.000 |
| 11610 | P4 | $25.000.000 | $1.000.000 |
| + 8 más | P2/P3/P4 | factor 10 | |

**Todas vienen del portal**: `origen_portal = PORTAL_V16`,
`created_by_rpc = landing_portal_v16_crear_solicitud`, desde navegadores reales (Chrome Android,
Safari iOS, Samsung Internet). O sea, el jugador escribe el monto y se lo aceptamos.

No se perdió plata —el operador lo corrige al aprobar— pero el campo `monto` queda podrido y
**cualquier reporte que sume `monto` está inflado por decenas de millones**. La más reciente es
del 2026-09-06: sigue pasando.

### Qué falta

Validar el monto en el portal contra algo razonable antes de crear la solicitud.

## D-66 · El total del parcial sale del monto de la solicitud, no del progreso

`window._retiroParcialInfo` (`renderer/core/archivo-historial.js:86`) calcula el total así:

```js
const total = Number((s&&(s.MONTO_REAL||s.MONTO_DECLARADO||s.MONTO))||0);
```

Toma el monto **de la solicitud**, no `retiro_parcial.total`. Con un monto podrido (D-65) la caja
de parciales muestra cifras delirantes y el cálculo de "cuánto falta" queda sin sentido. Fue lo
que hizo aparecer $64.900.000 "sin pagar" en un relevamiento por oficina.

## D-67 · 15 de 193 parciales: el registro no coincide con la plata movida

Contrastando contra `historial_ops` (contando un movimiento por número de Chunior, porque los
repetidos comparten número), últimos 45 días:

| Oficina | Parciales | No coinciden | Diferencia neta |
|---|---|---|---|
| P4 | 54 | 6 | −$174.799 |
| P2 | 40 | 4 | +$4.590.000 |
| P3 | 44 | 2 | +$225.000 |
| P1 | 3 | 2 | +$50.001 |
| P6 | 23 | 1 | −$500.000 |
| P7 | 21 | 0 | — |
| P5 | 8 | 0 | — |

Los **negativos** son los que importan para el jugador: el registro dice que se pagó más de lo que
realmente salió, así que puede venir a reclamar contra una solicitud que figura pagada.

El progreso vive en dos lugares que no se sincronizan (`retiro_parcial.pagado` y `monto_pagado`
suelto) — es D-12, todavía abierto.

## D-68 · 32 cierres manuales sin motivo · EXPLICADO, queda limpiar

En las 7 oficinas hay 32 retiros parciales cerrados a mano y **ninguno guardó el motivo**. En toda
la historia de la tabla hay 0 solicitudes con `cierre_motivo`, `cierre_nota` o
`retiro_parcial.cierre`.

**No es un bug.** La nota obligatoria entró el 2026-09-07 (`e8b3fcb`), viajó en v1.2.0 —publicada
el 2026-09-09 a las 12:41 UTC— y el último cierre manual fue el 2026-09-09 a las 02:14, diez horas
antes. Hoy las 8 oficinas corren 1.2.0, así que a partir de ahora los cierres tienen que traer
motivo. Verificado además con 5 pruebas sobre el bundle real (motivo y nota llegan, el progreso
previo no se pisa, sin nota no cierra, va a su caja, se dibuja y avanza).

### Qué falta

**Comprobación abierta:** el próximo cierre manual tiene que traer `cierre_motivo`. Si aparece uno
sin motivo, ahí sí hay un defecto y se caza con ese caso.

Y quedan **18 cierres históricos con deuda y sin explicación**. Hay que decidir si se rastrean uno
por uno o se asumen.

## D-69 · Apareció P8 y no está en ningún relevamiento

`panel_actividad` lista **P8** con latido del 2026-09-11. Todos los cortes por oficina hechos
hasta ahora asumen 7 oficinas (P1–P7). Hay que revisar si P8 es una oficina nueva o un puesto mal
codificado, y rehacer los números si corresponde.

## D-70 · `abrirChat` está definido cinco veces y gana el que no sirve

`window.abrirChat` se redefine en cuatro archivos:

| Orden de carga | Archivo | Recibe `id` |
|---|---|---|
| 4 | `extensions/portal-bridge.js:116` | sí |
| 8 | `extensions/portal-chat-unificado.js:103` y `:283` | sí |
| **10** | **`chat/chat-local.js:312`** | **no** |

`chat-local.js` carga último y define `window.abrirChat = async function(){ renderChatListStep2(); }`
— **ignora el id y sólo repinta la lista**. Ningún bundle posterior la vuelve a definir. Es el que
queda vivo, y explica que hacer clic en un chat no abra nada.

## D-71 · El parpadeo del chat: cuatro relojes sobre el mismo DOM

Sobre la misma lista corren a la vez:

- `portal-bridge.js:135` → recarga chats cada **15 s**
- `portal-bridge.js:136` → recarga el chat abierto cada **5 s**
- `chat-no-leidos.js:221` → cada **1,8 s** reescribe pestañas y marcadores
- más timers en `chat-local.js:336`, `chat-estabilidad.js:109`, `chat-macros.js:235` y `chat-hilos.js:685`

El de 1,8 s hace `state.textContent += ' · N nuevos'` y agrega marcadores sobre filas que otro
timer acaba de repintar. De ahí el parpadeo y el contador que salta 0↔N.

## D-72 · `landing_crear_chat_v2` tiene las oficinas hardcodeadas

```sql
if v_pc not in ('P1','P2','P3','P4','P5','PC1','PC2','PC3','PC4','PC5') then
  raise exception 'PC inválida';
```

**P6, P7 y P8 son rechazadas.** Cualquier chat iniciado desde esas oficinas falla. Las otras
funciones que crean sesiones (`chat_obtener_o_crear_sesion`, `landing_crear_chat`,
`nodo_chat_whaticket_accept`) no tienen ese tope.

## D-73 · No se puede iniciar un chat desde el panel

No hay **ni un llamador** de ninguna función de creación de chat en todo el renderer. El panel
sólo sabe responder sobre un chat que ya existe: `panel_core_enviar_chat_json` busca la sesión y
devuelve `CHAT_NO_ENCONTRADO` si no está.

El jugador nos puede escribir; nosotros no le podemos escribir primero. La RPC de creación ya está
habilitada en la lista blanca de `main/panel-rpc.js`, así que falta la acción en el panel (y
arreglar D-72 antes, o P6/P7/P8 no van a poder).

## D-74 · `chat_sesiones` congelada desde junio, `chat_mensajes` sigue viva

| Tabla | Filas | Últimos 7 días | Última |
|---|---|---|---|
| `chat_sesiones` | 116 | **0** | 2026-06-22 |
| `chat_mensajes` | 427 | **160** | 2026-09-09 |
| `chat_conversaciones` | 0 | 0 | — |

Los mensajes siguen entrando, pero **no se crea una sesión nueva desde el 22 de junio**. El chat
que funciona hoy se apoya en 116 sesiones viejas: un jugador sin sesión previa no puede tener una.
Es la misma forma que D-48 (la tabla muerta).

### Qué falta

Confirmar a qué sesiones se enganchan esos 160 mensajes nuevos, y decidir cuál de las dos
generaciones queda como la buena antes de tocar nada del chat.


## Estado al 2026-09-11 · qué se arregló de este relevamiento

| | Estado |
|---|---|
| D-64 · candado en "Cerrar el retiro" | **hecho** · botón que se apaga al primer clic + guarda de reentrada en `_rv2Finalizar` |
| D-66 · total del parcial | **hecho** · manda `retiro_parcial.total`, el monto de la solicitud queda de respaldo |
| D-70 · `abrirChat` | **hecho** · `chat-local.js` delega en la implementación real cuando recibe un id |
| D-71 · parpadeo del chat | **mitigado** · el reloj pasa a 4 s y no toca el DOM si no cambió nada. El problema de fondo (dos dueños de la misma lista) sigue abierto |
| D-72 · oficinas hardcodeadas | **hecho** · `landing_crear_chat_v2` acepta cualquier `P<n>` / `PC<n>` |
| D-63 · rotar la clave | **pendiente de decisión** · rompe producción si se hace sin coordinar |
| D-65 · montos absurdos del portal | **abierto** · hay que validarlo del lado del portal |
| D-67 · 15 parciales descuadrados | **abierto** · decidir si se rastrean uno por uno |
| D-68 · 18 cierres históricos con deuda | **abierto** · decidir si se rastrean o se asumen |
| D-69 · P8 | **abierto** · falta saber si es oficina nueva |
| D-73 · iniciar chat desde el panel | **abierto** · depende de resolver D-74 primero |
| D-74 · dos generaciones de chat | **abierto** · hay que decidir cuál queda antes de tocar el chat |


# ¿QUÉ PUEDE FRENAR QUE SE SUMEN MÁS OFICINAS? · 2026-09-11

Relevamiento pedido después de descubrir D-72 (una lista de oficinas escrita a mano frenaba a
P6, P7 y P8). Se buscó el mismo patrón en cuatro lugares: funciones SQL, restricciones de la
base, tablas de catálogo, y el código del panel y del admi.

**Lo que está bien** (queda anotado para no volver a investigarlo):

- No hay **ninguna restricción** (`CHECK`) en la base que limite los códigos de oficina.
- `_normalizar_pc` termina en `else upper(p_raw)`: deja pasar cualquier oficina.
- `pcAliasesHist()` (`renderer/core/historial-operaciones.js:9`) termina en `return v ? [v] : ["P1"]`:
  P8 devuelve `["P8"]`. El historial no se rompe.
- `canonPc` en `validacion-pc.js` y `validacion-scope.js` también deja pasar lo desconocido.
- **P8 ya está completa**: ruta pública activa, 6 alias de Chunior y 29 billeteras. Es una
  oficina real y provisionada, no un código mal tipeado.

## D-75 · El respaldo de "código de ruta → oficina" manda a P1 lo que no conoce

`landing_portal_v16_pc_from_code` es un `case` con los códigos de las cinco primeras oficinas
y **`else 'P1'`**. No rechaza lo desconocido: lo convierte en P1.

Probado contra los códigos reales:

| Oficina | Código | Resuelve a |
|---|---|---|
| P1–P5 | rt-a8f31 … rt-x2v61 | correcto |
| P6 | rt-r5023 | **P1** |
| P7 | rt-m2z3r | **P1** |
| P8 | rt-xvv80 | **P1** |

**No es un bloqueador activo.** `landing_portal_v16_crear_solicitud` resuelve primero contra
`landing_rutas_publicas` y sólo cae en el `case` si la tabla no encontró la ruta o está
inactiva. Las 8 oficinas tienen su ruta activa, así que hoy no se dispara.

**Es una trampa latente**, y por eso se anota: si una ruta se desactiva, se borra o el código
llega mal escrito, en vez de fallar con `AGENTE_NO_RESUELTO` la solicitud pasa a P1 **en
silencio**. De P1 a P5 el respaldo acierta de casualidad; de P6 en adelante manda la operación a
la oficina equivocada. Y como el asistente de alta genera el código al azar (`"rt-"+random`),
toda oficina nueva nace con un código que ese `case` no conoce.

### Qué falta

Sacar el `else 'P1'`: que devuelva null y que el llamador levante `AGENTE_NO_RESUELTO`. Fallar
es correcto; adivinar la oficina con plata de por medio, no.

## D-76 · El admi sólo deja filtrar de P1 a P5

En `admi-V23-COMPLETO-con-whaticket.html`, los tres selectores de oficina del tablero
—`dash_pc` (línea 57), `live_pc` (124) y `growth_pc` (181)— tienen las opciones escritas a mano
y llegan hasta P5. Además hay varios `["P1","P2","P3","P4","P5","P6"]` sembrados en
`loadPcs`, `fillPcSelects`, `renderOfiCards`, `adminFillAjustesSelects` y `fillHistorialPcSelect`.

**Desde el panel de administración no se puede filtrar por P6, P7 ni P8**: esas oficinas no
aparecen en los desplegables aunque tengan operación real.

## D-77 · Las autorespuestas de soporte excluyen a P8

`trg_soporte_autorespuesta` tiene `v_reales text[] := array['P1'..'P7']` con el comentario
"acá contesta de verdad". P8 quedó afuera: no recibe la autorespuesta de soporte.

## D-78 · El scope estricto de Verificaciones sólo sabe descartar P1 a P5

`renderer/extensions/validacion-scope.js:138-151` saca de la tabla las filas de otras oficinas
comparando contra una lista de textos fija: P1, PC1, P2, PC2, P3, PC3, P4, PC4, SANCHEZ, P5, PC5.

P6, P7 y P8 no están en esa lista, así que **sus filas no se descartan en ninguna oficina**: se
ven desde todas. Es la misma clase de fuga entre oficinas que D-60, pero al revés — no es que
una oficina vea de más por error de consulta, es que el filtro no sabe que existen.

(El alias sí resuelve bien: `PC_ALIAS[c] || [c]` deja pasar P8. El problema es sólo el descarte.)

## D-79 · Un desplegable de oficina con P1–P5 fijo en la cola de validación

`renderer/extensions/validacion-cola.js:290` arma `<option value="P1">…<option value="P5">` a
mano. Mismo patrón que D-76, del lado del panel.

## Pendiente de revisar

`panel_nodo_list_chats` tiene un `or upper(coalesce(cs.pc_codigo,'')) = 'P1'` dentro del filtro
de oficina, que haría visibles los chats de P1 desde cualquier oficina. No se terminó de
verificar porque hoy es discutible: `chat_sesiones` está congelada desde junio (D-74) y no se
crean sesiones nuevas. Revisarlo cuando se decida qué generación de chat queda.


## D-80 · Mientras el panel opera no se puede copiar el enlace de acceso · RESUELTO

Reportado por Juan: "la aplicación, al estar haciendo algo, no te deja copiar el enlace del
usuario para que ingrese ya validado". Son **dos** fallas encadenadas, y por eso no quedaba ni
el enlace ni un aviso.

### Por qué

**1) El portapapeles exige foco.** `navigator.clipboard.writeText()` sólo escribe si la ventana
lo tiene. Mientras el panel opera, abre y **enfoca** otra ventana: `main/agent-ipc.js:21-22`
hace `win.show(); win.focus();` (y otra vez en :37), y `main/chunior-window.js:122,130-131` lo
mismo. Con el foco en el backoffice, la escritura al portapapeles se rechaza.

**2) El respaldo estaba muerto.** `jugadores-crm.js` caía en
`catch(_e){ prompt("Copiá el enlace:", url); }`, y **prompt() no existe en Electron**. Ya estaba
dicho en el propio código: *"⚠ Electron NO soporta prompt() (tira excepción y el botón 'no hace
nada')"* (`conciliacion.js:697`) y *"Sin prompt() (Electron no lo soporta)"* (`chat-acciones.js:41`).
Se coló igual justo en el botón del enlace.

Resultado: fallaba el primero, el segundo no hacía nada, y el operador se quedaba sin el enlace
**y sin enterarse**.

Buscando eso aparecieron dos lugares con la misma falla, pero silenciosa:

- `renderer/core/jugadores-importacion.js:292` — `copiarDatosUsuario` terminaba en `.catch(()=>{})`.
- `renderer/portal/operation-modal.js:1012` — `expedienteCopiarTexto` no tenía `catch` ninguno.

### Qué se hizo

Un solo `window.nodoCopiar(texto, {etiqueta})` en `renderer/core/archivo-historial.js`, al lado
del `portalCopiarCbu` que ya resolvía esto para el CBU. El orden importa:

1. **Recupera el foco** con `ctrlElectron.refocus()` — que ya existía (`main/panel-window.js:72`,
   agregado para recuperar el teclado después de un `confirm()` nativo). Ésta es la cura de la
   causa real.
2. Portapapeles moderno.
3. `textarea` + `execCommand`, fuera de pantalla pero seleccionable.
4. Si nada funcionó, **muestra el texto en un modal para copiarlo a mano**. Nunca `prompt()`.

Y nunca dice "copiado" sin haber copiado: devuelve `false` y avisa.

Enganchados al helper: el enlace de acceso, "Copiar datos" de la ficha de ingreso (que tenía el
mismo problema de foco) y los dos que fallaban en silencio.

Cubierto con 4 pruebas sobre el bundle real: que el texto no se pierda en el peor caso, que no
mienta cuando sí copia, que no invente nada sin texto, y que no vuelva a aparecer un `prompt()`
como respaldo.

### Qué falta

Quedan **otros dos botones que usan `prompt()`** y por lo tanto no hacen nada en Electron:

- `renderer/extensions/validacion-cola.js:396` y `:398` — validar un usuario a mano.
- `renderer/extensions/validacion-scope.js:185` — lo mismo.

No se tocaron en este pase. Hay que reemplazarlos por un modal, como ya se hizo en el resto del
panel.


## D-81 · Todo se mueve solo debajo del cursor · RESUELTO

Reportado por Juan con capturas: "cada vez que se refresca se mueve todo — si tenés el cursor en
aceptar, se desplaza hacia abajo y después arriba y queda desfasado". Y, pegado a eso, que al
abrir el modal de una carga aparecía **el proceso de la carga anterior**.

No era un problema: eran cinco, todos de la misma familia — algo aparece o crece DESPUÉS de que
el operador ya decidió dónde iba a hacer clic.

### 1) El bloque de la cola empujaba la lista entera

`_colaCargaBox()` inserta su bloque **arriba** de `tablaSolicitudesInicio`. Al aprobar, ese
bloque nacía y empujaba toda la lista hacia abajo; al terminar, desaparecía y la devolvía arriba.
Justo el recorrido que hace el cursor cuando el operador va a aprobar la siguiente.

### 2) La misma solicitud dibujada dos veces

Mientras estaba en la cola, la carga se veía **en la cola y en pendientes al mismo tiempo**, con
la tarjeta de pendientes exactamente igual que antes de aprobarla — mismo botón "Aprobar"
disponible. De ahí la sensación de que la app no estaba haciendo nada, y el doble clic sobre la
misma carga.

Ahora la cola publica su estado en `window._colaCargaEstado` y **la tarjeta lo muestra en su
lugar**: badge "⚙ Cargando…" / "🕒 Nº en la cola", y las acciones pasan a "Sacar de la cola" + "Ver".
El bloque de arriba sólo dibuja lo que NO está a la vista en la lista (que muestra 8), así que en
el caso normal no aparece y no empuja nada.

### 3) El resultado de una carga escribiéndose en el modal de la siguiente

El modal de aprobar es **uno solo** y se reusa. La operación corre en segundo plano, así que para
cuando termina el operador ya abrió el de la siguiente solicitud — y ahí se escribía
"Operando en Agentes...", "✅ CARGA completada", y se le apagaba el botón Aprobar con "Operando...".
Todo de **otra** solicitud.

`_ejecutarSolicitudAhora` capturaba `portalJobResultado` y `portalJobEnviarBtn` al arrancar y
escribía sin volver a preguntar. Ahora hay un guard (`_esMiModal`): sólo pinta si el modal sigue
siendo el de ESA solicitud. Los ~12 lugares que escriben quedaron igual — el envoltorio los filtra.

### 4) Los modales creciendo mientras se los usa

En "Validar y vincular" entran tres bloques async uno abajo del otro (cotejo, teléfono,
antecedentes) y el modal entero scrolleaba: **los botones bajaban solos** mientras el operador iba
a apretarlos. Lo mismo en "Aprobar portal" con el bono y el vínculo, que llegan después de que el
monto ya está pintado.

Arreglado en los dos, y en todos los modales del panel de una: scrollea el **cuerpo**, el título y
los botones quedan fijos (`.modal` pasa a flex column, `#modalBody` con `overflow-y:auto`).
En el modal del portal, la parte que crece vive en `#portalJobScroll` y "Monto a procesar" y
"Aprobar" quedan abajo, quietos.

### 5) Dos carteles ocupando esquinas

- La tira de proceso (`#trazaStrip`) estaba **centrada** (`left:50%`): flotaba en el medio de la
  pantalla, tapaba la tabla y se montaba a la barra de desplazamiento. Va abajo a la izquierda,
  donde no hay ni scrollbar ni panel de chat — así se ve igual con el chat abierto o cerrado.
- El cartel "NODO · PILOTO OPERATIVO" ocupaba la esquina de abajo a la izquierda de forma
  permanente sin decir nada accionable. Se sacó; el badge de Agentes baja a esa esquina.

## Lo que NO se tocó

**La frecuencia de refresco.** El portal se relee cada 60s y el chat cada 15s, y después de cada
operación se fuerza otra lectura. No se cambió ningún intervalo: el salto que se veía era el
layout, no el refresco. Si con esto sigue sintiéndose brusco, lo que hay que revisar es el
`renderHistorialUnificado`, que repinta la tabla entera sin el guard de "no repintar si no cambió"
que sí tiene la lista de pendientes.


## D-82 · Lo que apareció explicándole el panel a las oficinas · RESUELTO

El 2026-09-11 Juan le explicó el historial y el expediente a las oficinas por Discord. En esa
charla salieron cuatro fallas — ninguna reportada antes, todas visibles apenas alguien mira la
pantalla con ojos nuevos. Vale anotar el mecanismo: **la explicación funcionó como test**. Tres de
las cuatro son la misma clase de error — el panel TIENE el dato y no lo usa.

### 1) "Chat Jugador" abría el apartado, no la conversación

Reportado textual: *"yo toco chat del jugador y me abre el apartado pero no me abre el chat con el
usuario"*.

`expedienteAbrirChatJugador` sólo abría la conversación si la solicitud traía `chat_id`. Las
operaciones manuales no lo traen, y muchas del portal tampoco. En ese caso hacía
`mostrarVista('chat')` y escribía el nombre en un input `#filtroTexto` — que en esa vista no
existe. O sea: cambiaba de pantalla y nada más.

Ahora busca la conversación **por usuario** en `ticketsAgrupados()` y la abre con
`aceptarTicketLocalStep2`. Si el jugador no tiene ninguna, **lo dice**: hoy el panel no puede
iniciar una conversación (ver D-73), y quedarse en silencio hace pensar que el botón está roto.

### 2) El titular vacío en las operaciones manuales

Juan lo vio en vivo: *"se ve el usuario, actualmente parece no notar el titular"*.

Una operación manual no tiene columna `TITULAR`: el titular viaja **dentro de `notas`**, tal
como lo escribe `portalNotasBase` (`"#206911 · Titular: Fulano · Alias: ..."`). La ficha leía
`s.TITULAR`, `NOMBRE_COMPLETO` y `metadata.titular`, no encontraba nada y mostraba "—"
mientras el dato estaba a la vista dos renglones más abajo, en el campo Notas. Ahora lo lee de ahí.

### 3) La ficha que se le manda al jugador llevaba vocabulario nuestro

Juan: *"no debe ver 'chunior', el titular no lo agarra ni de onda, landing es extraterrestre para
ellos, no hace falta que lean eso"*.

"Copiar Ficha" arma el texto que se le manda al jugador cuando reclama, y ese texto incluía
`🎲 Mov. Chunior: N° 9647510` y `Origen: LANDING`. Se sacó el número de Chunior (sigue en la
ficha en pantalla, que es donde lo usa el operador) y el origen pasa a castellano:
LANDING/PORTAL → "Portal", MANUAL → "Carga manual".

De paso, ese botón copiaba con `navigator.clipboard` directo y un `catch` que sólo avisaba:
pasó a `nodoCopiar` (D-80), que recupera el foco y, si aun así no puede, muestra el texto en vez
de perderlo.

### 4) Dos solicitudes abiertas del mismo jugador, sin relación visible

Una oficina preguntó: *"los usuarios pueden hacer 2 solicitudes a la vez ahora?"*. Sí — siempre
pudieron. Se vio un jugador con dos CARGAS abiertas con un minuto de diferencia.

El bloqueo real es del **portal** (Juan ya lo tiene resuelto ahí, sin probar). Pero del lado del
panel esas dos solicitudes se dibujaban como dos tarjetas sin ninguna relación entre sí, y cargar
las dos es plata de verdad. Ahora la tarjeta avisa cuántas hay abiertas de ese jugador. **No
bloquea**: a veces son dos transferencias legítimas, y el que decide es el operador.

## Nota de método

Las cuatro salieron de explicar el sistema, no de usarlo. Conviene repetirlo: mostrarle el panel a
alguien que no lo escribió encuentra en una hora lo que no aparece en semanas de operación, porque
el que opera ya aprendió a esquivar los baches sin registrarlos como fallas.


## D-83 · ¿NODO levantó las operaciones? · MEDIDO · el número NO acompaña

Pedido: comparar cargas antes y después de NODO para respaldar que NODO levanta operaciones.
Se midió. **El dato no sostiene esa afirmación en volumen.** Queda anotado con el método completo
para que no haya que rehacerlo, y para que nadie salga a decir en una reunión algo que la base
contradice.

### De dónde salen los números

`historial_ops` **no sirve** para el "antes": esa tabla empieza cuando empieza NODO. El "antes"
está en `agente_operaciones_importadas` (635.211 filas) — el registro del propio casino,
importado por CSV, que existe de los dos lados de la línea.

Cuatro controles de validez antes de usarla:

1. **Duplicados: 0,0%.** Hay lotes que se pisan en fechas ("AGENTES - ENERO/SEPT" y varios CSV),
   pero sobre (pc, fecha, alias, monto, tipo) hay 635.169 combinaciones únicas de 635.211 filas.
2. **Cobertura por oficina: despareja.** Sólo **P2, P3, P4 y P5** tienen los 9 meses. P1 corta en
   junio, P6 sólo tiene junio, P7 junio–julio, P8 tiene 22 filas. **El análisis se limita a esas
   cuatro** — usar el total global daría una caída falsa, porque cambia la cantidad de oficinas
   cubiertas mes a mes (4 → 5 → 7 → 5).
3. **Días completos.** Enero a agosto tienen 31/28/31/30/31/30/31/31 días con datos en las cuatro.
   No faltan días, así que el promedio diario es comparable.
4. **El registro del casino captura lo que hace NODO.** En agosto las cargas OK de NODO son el
   93% de los depósitos del casino en las mismas oficinas — la diferencia es lo que se carga a
   mano directamente en el casino. **Septiembre hay que descartarlo**: el import corta el 4/9 y
   ahí NODO registra 3 veces más que el casino (310%–340%), o sea el import está incompleto. La
   primera medición incluía septiembre y ensuciaba el "después"; se rehízo cortando en agosto.

### El resultado

Cada oficina contra sí misma. Antes = 1/1 hasta el día que arrancó NODO. Después = ese día hasta
el 31/8. Depósitos por día:

| Oficina | Arrancó NODO | Antes | Después | Ops | Monto |
|---|---|---|---|---|---|
| P2 | 07/07 | 716,3 | 729,5 | **+1,9%** | +9,7% |
| P5 | 08/07 | 213,4 | 220,4 | **+3,3%** | −12,4% |
| P3 | 01/07 | 569,3 | 508,0 | **−10,8%** | −6,7% |
| P4 | 24/06 | 910,7 | 713,6 | **−21,6%** | −6,9% |

Dos planas y dos en baja. **No hay alza.**

### Y hay algo peor, que es el hallazgo de verdad

Los **jugadores activos caen fuerte**, y lo confirman **dos fuentes independientes**:

- Registro del casino (P2–P5): 5.211 en junio → 4.562 en julio → **3.422 en agosto**.
- NODO por su cuenta (P2–P5): 4.010 en julio → **3.405 en agosto**.

De los 4.010 que operaron en julio, en agosto **siguieron 2.253 (56%)** y **1.757 (44%) no
operaron en ninguna oficina**. Se probó la hipótesis de que se hubieran mudado a las oficinas
nuevas: **cero** de esos 1.757 aparece en P6, P7 o P8. No es reacomodamiento, es pérdida.

Y los jugadores nuevos vienen en baja: 4.802 vistos por primera vez en julio (inflado por la
migración), 2.032 en agosto, 395 en los primeros 11 días de septiembre.

**Salvedad honesta:** julio es un mal punto de partida porque es el mes de la migración y está
inflado. Pero la serie del casino —que no depende de NODO— cae igual desde junio.

### Lo que el dato SÍ sostiene

NODO no agregó demanda. Lo que hizo, y se mide sin discusión, es **absorber el mismo trabajo con
la misma gente y sacárselo de encima al operador**:

| | Julio | Agosto | Septiembre |
|---|---|---|---|
| Operaciones por el portal | 63,2% | 87,5% | **94,1%** |
| Cargadas a mano | 21.116 | 10.601 | **1.696** |
| Operadores activos | 45 | 44 | 42 |
| Operaciones por operador | 1.439 | 2.172 | ~2.166 (ritmo) |

Los mismos ~44 operadores pasaron de 2.032 a 3.028 operaciones por día, y el trabajo manual cayó
92%. **Ese** es el argumento defendible: no más negocio, sino el mismo negocio con muchísima menos
carga operativa y todo registrado.

### Qué habría que medir para cerrar la pregunta de verdad

El diseño tiene un límite real: las cuatro oficinas adoptaron NODO en **dos semanas** (24/6 al
8/7), así que no hay una oficina comparable que se haya quedado sin NODO en el mismo período. Sin
ese control no se puede separar el efecto de NODO de lo que haya pasado en el mercado en julio y
agosto. Para responderlo bien haría falta el registro del casino de una operación que NO use NODO
en esos meses.

**Prioridad real: la caída de jugadores activos.** Es un 34% en dos meses, confirmado por dos
fuentes, y no tiene nada que ver con si NODO levanta o no operaciones. Eso es lo que hay que
mirar primero.


## D-84 · La ronda de pruebas del 12/09 · RESUELTO salvo la búsqueda

Juan probó el panel con un usuario de prueba y dejó el retiro parcial en *"inutilizable de manera
directa"*. Tenía razón, y varias fallas eran arreglos anteriores que no terminaron de arreglar:
el chat se "resolvió" en D-82 con un cartel en vez de resolverse, y el parcial se dio por
verificado en D-66 sin estarlo.

### Retiro parcial

**Escribías un dígito y el modal se redibujaba.** `_rv2InputTotal` estaba definida **dos
veces** en `withdrawals-view.js`. La segunda pisaba a la primera y terminaba en `_rv2Render()`,
que reescribe el modal entero —incluido el campo donde se está tipeando—: se perdía el foco y
había que volver a hacer clic para cada dígito. Se sacó la segunda. (La lectura de saldo en
Agentes NO redibuja el modal: sólo repinta el veredicto y el botón. Se verificó.)

**"Las billeteras no cubren el total · se puede pagar $0 ahora"** con $160.870 en una billetera.
El modal arranca sin billetera elegida **a propósito** (pre-elegir hizo pagar de más una vez), y
el veredicto leía "elegido = $0" como "no hay plata". Ahora distingue tres casos: no elegiste
("elegí de qué billetera pagar"), no alcanza entre todas, y lo elegido no cubre.

**"Retirar todo lo que tiene" no funcionaba.** Sí abría el modal, pero el reparto sugerido
(`recomendarRepartoRetiro`) sólo mira billeteras de **$200.000 o más**. En una oficina chica —o
en el entorno de prueba— ninguna llega, el reparto volvía vacío, y el modal quedaba en $0 con el
cartel de arriba. Como acá el operador PIDIÓ pagar ese monto, si el reparto no encuentra nada se
reparte entre las billeteras que haya, de mayor a menor. Además esperaba 350 ms a ciegas a que el
modal montara; ahora espera a que exista el estado del retiro.

**"Se perdió el estado del retiro antes de cerrarlo".** Es la continuación de D-64. `_rv2Confirmar`
tiene el estado en la mano mientras extrae las fichas, anota en Chunior y debita; pero al
terminar llamaba al cierre **sin pasárselo**, y el cierre lo volvía a buscar en el global, que
cerrar el modal pone en `null`. Resultado: la plata salía y la solicitud no se actualizaba. D-64
lo hizo **visible**; esto lo **arregla**: el cierre usa el estado que ya se tenía.

### "Ver" en solicitudes

`abrirExpedienteSolicitud` pintaba el expediente en un panel que vive abajo de todo, en el centro
de control, y sólo abría el modal en pantallas de **menos de 1080 px**. En un monitor normal,
"Ver" dibujaba algo fuera de la vista. Además buscaba el modal **antes** de crearlo, así que la
primera vez no aparecía aunque se lo pidiera. Desde pendientes ahora siempre abre el modal.

### Editar un movimiento en Chunior bloqueaba a TODOS

`expedienteEditarMovimiento` comparaba el operador de la fila contra `String(operador)`. Pero
`operador` es un **objeto**: eso da `"[object Object]"`, que no coincide con nadie. Bloqueaba la
edición a todos —incluido el que hizo el movimiento— y como el mismo valor viajaba a
`panel_mov_editar`, el servidor también rebotaba. Ahora compara contra el usuario **logueado en
Chunior en este momento**, leído en vivo con `refrescarOperadorDesdeChunior(true)` — lo mismo que
ya hacían las billeteras, que es lo que Juan había pedido.

### El chat: D-73 RESUELTO

El panel sólo podía **responder**. `nodoEnviarMensajePortal` devuelve `"sin-ticket"` si el
jugador nunca escribió, y en D-82 eso se tapó con un cartel de *"todavía no se puede"*.

Se investigó cómo lo lee el portal antes de escribir nada. `landing_portal_chat_thread_get` toma
**la última solicitud de SOPORTE del jugador que tenga `chat_thread`**, sin importar quién la
creó, y el portal la pide cuando el jugador abre el widget. Así que iniciar un chat es crear esa
fila. Las dos funciones que ya existían para "crear chat" no servían:

- `landing_crear_chat_v2` y `nodo_chat_whaticket_accept_v2` escriben en `chat_sesiones` /
  `chat_mensajes`: la generación de chat **congelada** (D-74). El portal no lee eso.
- `landing_portal_v16_crear_solicitud` es la del portal: firmaría el mensaje como del jugador.

Se creó `panel_chat_iniciar(p_secret, p_pc_codigo, p_usuario, p_mensaje, p_operador)`. Tres
condiciones que no son arbitrarias:

- **`origen = 'PORTAL_V16'` y estado `EN_REVISION`**: es lo único que lista la bandeja del panel.
  Con otro origen, la conversación existiría y no se vería nunca.
- **La grafía del usuario del portal.** El portal busca con `usuario = p_usuario` exacto; se toma
  la del último pedido del jugador, no la que tipee el operador.
- **Si ya hay conversación en esta oficina, se suma ahí** y se reabre. Si la última es de otra
  oficina, se crea una acá.

Se verificó: la función existe, con clave incorrecta devuelve `NO_AUTORIZADO` sin escribir
nada, y `anon` la puede ejecutar (que es como la llama el panel).

Puertas para escribirle a alguien: **"Chat Jugador"** en el expediente (ahora abre el cuadro para
escribir en vez del cartel) y **"💬 Mensaje"** en la ficha del jugador, que se abre desde el CRM,
el historial y el expediente.

**Lo que no se pudo verificar desde acá:** que el portal *pinte* un mensaje cuyo primer renglón es
del operador. Lee el hilo sin filtrar por origen y ya muestra las respuestas del operador, así que
debería — pero se confirma mandándole un mensaje a un usuario de prueba y abriendo su portal.

**Seguridad.** La función usa la misma clave de datos que está filtrada (D-63). No abre una clase
de riesgo nueva —esa clave ya permitía escribir `chat_thread` en cualquier solicitud vía
`panel_v15_5_actualizar_solicitud_portal`, que mezcla el metadata sin lista de campos—, pero
**mandarle un mensaje a cualquier jugador** es exactamente lo que buscaría alguien que quiera
estafarlos. Otro motivo para rotar la clave.

### Los carteles repetidos NO eran un bug

Se vieron 2 y 4 carteles idénticos apilados. Los botones tienen un solo `onclick` cada uno: eran
**clics repetidos sobre un botón que no hacía nada visible**. Arreglado lo de abajo, no aparecen.

### La búsqueda · ABIERTO

Dos cosas distintas en las capturas, ninguna tocada:

- *"Sesión de Agentes caída — 'buscar usuario' no se ejecutó. Se abrió el login"* es el panel
  avisando **bien** que se cayó la sesión del casino. Hay que entrar en la ventana que abre.
- *"«usuario de prueba» NO existe en Agentes"* a los 10,8 s, en BET300. Ese preload sólo concluye "no
  existe" si la lista **se refrescó, quedó estable y el texto buscado se verificó** (regla
  anti-falso-negativo); si no, reintenta y termina en error técnico. O sea que el casino dijo que
  no está. Lo más probable es que el usuario de prueba exista en el **otro** entorno (Juan
  alternó entre BET300 y Drex). No se puede confirmar sin el casino.


## D-85 · Segunda ronda del 12/09 — el parcial otra vez, la sesión de Drex, los íconos · RESUELTO salvo lo marcado

Juan volvió a probar el parcial sobre la solicitud de prueba y le volvió a pasar lo mismo:
*"vuelve a ser el mismo problema anterior, la verdad una vergüenza"*. Tenía razón.

### "Se perdió el estado del retiro" — el camino que D-84 no cubrió

D-84 arregló la llamada al cierre en el camino de **"confirmar una por una"** (`_rv2Confirmar`).
Juan pagó con esa casilla **destildada**, que es el camino por defecto y es **otro código**:
`_rv2Aprobar` cierra el modal apenas saca las fichas (`cerrarRetiroV2()` pone el estado global en
`null`, línea 134) y veinte segundos después, tras anotar en Chunior y debitar, llamaba al cierre
**sin pasarle el estado** (línea 226). Se arregló una llamada sin buscar las demás.

Esta vez se verificó el cuerpo **entero** del cierre (usa el `st` que recibe en todo momento) y la
prueba nueva no mira una línea: exige que **ninguna** llamada al cierre quede sin el estado.

Además, a pedido de Juan, **se sacó "Confirmar una por una"**: no aportaba y era justamente un
segundo camino de código para lo mismo.

### "Pagarle todo lo que tiene" no cambiaba la solicitud

En el modal, el botón cambiaba **lo que se paga ahora** pero no **el total de la deuda**, que quedaba
en lo declarado ($50.000). El cierre calculaba contra eso y dejaba un parcial fantasma por plata que
el jugador no tiene. Ahora corrige el total y lo escribe en la solicitud (`monto_corregido`), como
ya hacía el atajo de la tarjeta.

Ese atajo de la tarjeta ("✔ Retirar $X") sólo aparecía si el escaneo en segundo plano había leído
el saldo de ese jugador; después de recargar el panel no aparecía. Ahora también lo alimenta la
lectura que hace el modal.

### "NO TIENE FICHAS · $0" con la sesión caída — Juan: *"miente"*

Dos fallas encadenadas:

- **El preload de Drex miraba sólo el primer modal.** `detectarModalSesionInvalida` hacía
  `querySelector` por selector. Con el modal del saldo del jugador abierto hay **dos**
  `ReactModal`: agarraba el del jugador, el texto no coincidía, y el de *"session is invalid"*
  —que estaba encima— pasaba de largo. Ahora revisa todos. (Juan pasó el HTML exacto del modal.)
- **El panel creía cualquier número.** `_rv2LeerSaldo` tomaba `balance.value` sin mirar si la
  sesión estaba caída ni si el texto tenía dígitos. Ahora con la sesión caída dice *"se cayó la
  sesión de Agentes"* en vez de *"no tiene fichas"*, y al pagar dice lo mismo en vez de *"no existe"*.

### El modal de ingreso no aparecía estando en el login de Drex

`ensureDrexSession` sólo abre el modal si el preload dice `needsLogin`. `pageNeedsLogin` daba la
sesión por buena apenas encontraba `#searchButton` **en el DOM**, sin mirar si se ve. Drex es una
SPA y puede dejar la búsqueda montada pero oculta al mandarte al login. Ahora exige que sea visible.
Se verificó que `estadoPagina` → `status()` → `pageNeedsLogin()` es el camino que usa el panel.

**Lo que no se pudo verificar:** contra la pantalla de login real de Drex, porque desde acá no hay
casino. Si con esto sigue sin abrirse, hace falta el HTML de esa pantalla, igual que el del modal.

### Los íconos de la barra salían como "ðŸšª"

Son emojis en `content:` de `base.css`. Los archivos estaban **bien**: UTF-8 válido, sin doble
codificación, el `.htm` declarando UTF-8 dos veces. Fue la app la que leyó la hoja de estilos como
Windows-1252. No se encontró el disparador (Electron es el mismo 32.3.3). El arreglo no depende de
encontrarlo: el build declara `@charset "UTF-8"` en la primera línea de cada CSS que genera, y los
ocho emojis de `content:` pasaron a escapes (`\\1F6AA`), que son ASCII puro.

(Se descartó en el camino que los `.js` tuvieran el mismo problema: leídos como Windows-1252,
ninguno se rompe.)

### La solicitud de prueba quedó inconsistente · ABIERTO — decisión de Juan

La #207577 (usuario de prueba, retiro de $50.000) figura en `ERROR_OPERATIVO` y **sin ningún pago
registrado** (`retiro_parcial` vacío). Pero se pagaron **dos veces**, las dos con el bug de arriba:

| Fecha | Monto | Chunior | Desde |
|---|---|---|---|
| 11/09 | $25.000 | N° 9648653 | SALVATIERRA X |
| 12/09 | $1 | N° 9655726 | SALVATIERRA X |

Si alguien la reintenta así, paga los $50.000 enteros encima. **No se tocó**: registrar $25.001 de
progreso es escribir estado de plata, y aunque sea una cuenta de prueba, es decisión de Juan.

### El instalador 1.2.1 compilado antes de esto quedó viejo

Se había compilado con el parcial todavía roto y los íconos rotos. Se recompila con esto; los
archivos anteriores de `dist/` no se tienen que subir.


## D-86 · Tercera ronda del 12/09 — versión en el login, búsqueda de BET300, total del parcial · RESUELTO en el código

Lo que Juan confirmó que **ya anda**: iniciar un chat desde el panel, y "pagarle todo lo que tiene"
corrigiendo el monto de la solicitud.

### El cartel de versión en el medio del login

Juan lo había pedido antes (*"al lanzar la aplicación debe quedar en una esquina, no flotando en el
medio"*) y **se entendió mal**: se movió la tira de proceso en vez del cartel de versión. El cartel
se engancha al borde del panel de chat (`_updaterAnclar`), y en la pantalla de login el chat está
tapado pero sigue midiendo: el cartel quedaba en el medio. Ahora, con el login a la vista, va a la
esquina.

### La búsqueda de BET300: *"no esperó… dio error… no reintentó"*

`buscarUsuario` tiene tres reintentos, pero **antes** del bucle `ensureReady` preguntaba "¿página
bloqueada?" y, si sí, devolvía error sin reintentar. Y la pregunta estaba mal hecha: `pageIsBlocked`
buscaba en el texto de la página los números **`502`, `503` y `504` sueltos**, así que cualquier
saldo o N° de movimiento con esos dígitos hacía que la página "pareciera" un error del servidor. El
preload de Drex ya había sacado esa trampa; el de BET300 no.

Arreglos: sin números sueltos; `ensureReady` espera hasta 8 s a que la pantalla monte antes de
concluir "bloqueada"; `buscarUsuario` vuelve a la pantalla de búsqueda una vez antes de rendirse; y
`_asegurarInicio` despliega un grupo "Agentes" plegado si "Control de agentes" está adentro.

**El campo MUI que pasó Juan** es de la pantalla "Buscar jugadores" (con el selector "bet300.club"),
no del buscador de "Control de agentes" que este preload sabe leer — ahí anduvo al segundo intento.
El arreglo no es escribir en ese campo (los resultados de esa pantalla no son legibles para el
preload) sino volver a la pantalla correcta. **No se pudo verificar contra el casino.**

### El ritmo del retiro

*"Busca, espera, busca de nuevo, espera y retira de la nada rapidísimo."* Pausa de 1,2 s **a la
vista** antes de apretar "Enviar" en los retiros —también es margen real para el ⛔ Cancelar— y se
re-busca el botón después de la pausa. En la carga no se agregó: pasan cientos por día.

### El parcial no tomaba el monto corregido

`landing_retiro_registrar_parcial` calculaba el total con el total ya guardado o la columna `monto`
—lo que el jugador declaró—, nunca con `monto_corregido`. Con la solicitud corregida a $35.019, el
primer pago guardó `total = 50.000` y la caja dijo "falta $45.000". Se arregló la función (migración
`retiro_parcial_respeta_monto_corregido`: manda la corrección) y la caja del panel.

La #207577 sigue con `retiro_parcial.total = 50.000` guardado hasta el próximo pago, pero el panel
ya muestra $35.019. **Sigue abierto** lo de D-85: los $25.001 pagados sin registrar.

### Los parciales "desaparecieron" del centro de control

No se borró nada: el centro de control trae **sólo el turno actual**, y un parcial de ayer no entra
en esa ventana. Un retiro a medio pagar es trabajo pendiente: ahora tiene su botón **💸 Parciales**
en la barra del centro de control, igual que en la pantalla de inicio.

### Pedidos nuevos

- **Operaciones desde las 00** en el medio de la barra del centro de control: cargas y retiros OK
  de la oficina desde las 00:00, contados en el servidor con el mismo filtro que el historial.
- **El cartel de la clave blanqueada se copia al tocarlo** (usuario y clave, listos para el jugador).
