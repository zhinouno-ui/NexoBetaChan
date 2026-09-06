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
