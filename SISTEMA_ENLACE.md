# SISTEMA DE ENLACE — atar portal ↔ servidor ↔ NODO ↔ Chunior

Propuesta de arquitectura. **Nada de esto está aplicado**: es el plan para discutir y
después ejecutar por fases. Los números son reales, medidos contra el proyecto Supabase
`NODO` (`pjvvyvfcwjoocjqvdror`) el 2026-09-06.

Los defectos concretos que originan esto están fichados en [DESCONEXIONES.md](DESCONEXIONES.md).

---

## 0 · El diagnóstico en una línea

Hoy **una operación no es una cosa**: son hasta cuatro registros sueltos que nadie ata —
la solicitud del portal, la fila del historial, el movimiento de Chunior y lo que ve el
usuario. Cuando uno de los cuatro falla, los otros tres no se enteran.

Medido sobre los últimos 30 días:

| Origen | Operaciones | Sin `solicitud_id` | `OK` sin N° de Chunior |
|---|---:|---:|---:|
| LANDING | 84.555 | 568 (0,7 %) | 141 |
| **MANUAL** | **7.898** | **7.898 (100 %)** | **1.372 (17,4 %)** |
| PROMO_BONO | 891 | 0 | 5 |
| ADMIN | 287 | 287 (100 %) | 2 |
| DEPO_RECLAMADO | 97 | 97 (100 %) | 0 |
| LANDING·PARCIAL | 13 | 0 | 11 (85 %) |
| MANUAL_LOCAL | 7 | 7 (100 %) | 7 (100 %) |

En 60 días: **173.415** operaciones, **33.715 (19,4 %) sin ninguna solicitud asociada** y
**3.127 en estado OK sin número de Chunior**.

Eso confirma las dos cosas que venías diciendo: *las cargas manuales el usuario no las
tiene*, y *hay operaciones que no enganchan número de Chunior*. No es una sensación:
son 7.898 y 1.372 en un mes.

---

## 1 · El código de movimiento (el eje de todo)

### Lo que hay hoy no sirve

`metadata.public_code` **parece** un identificador de operación y no lo es. En 30 días:
107.110 solicitudes lo tienen y hay **7 valores distintos**. Es el código de la *ruta
pública* de cada oficina, de `landing_rutas_publicas`:

| public_code | Oficina | Solicitudes que lo comparten |
|---|---|---:|
| `rt-z9p42` | P4 · SANCHEZPLATA | 28.256 |
| `rt-k6d92` | P2 · ALV | 25.804 |
| `rt-m4q77` | P3 · CHINO | 17.843 |
| `rt-m2z3r` | P7 · CRISTIANPLATA | 15.742 |
| `rt-r5023` | P6 · MORENOPLATA | 13.160 |
| `rt-x2v61` | P5 · F | 6.263 |
| `rt-a8f31` | P1 · Canal 1 | 42 |

Un usuario que te dicte `rt-z9p42` te está diciendo "soy de P4". Eso es exactamente el
"id falso que nadie puede ver ni buscar".

### Propuesta: `codigo_op`, único por operación

- **Se genera en el servidor**, nunca en el cliente. Así no depende de que NODO esté
  vivo, ni de la conexión, ni de que la ventana de Chunior responda.
- **Dictable por teléfono**: alfabeto sin ambigüedad (sin `0/O`, sin `1/I/L`).
  Formato propuesto: `P4-C-6K3M9T` → oficina, tipo (C carga / R retiro), 6 caracteres.
- **Único global** y con índice, para que buscarlo sea instantáneo.
- **Es el mismo código** en la solicitud del portal, en la fila del historial, en el
  mensaje al usuario y en la nota que se escribe en Chunior. Un solo número para todo.

Con eso, "tengo un problema con esta carga" pasa de ser una arqueología de montos y
horarios a pegar un código en un buscador.

---

## 2 · Que toda operación tenga dueño (la solicitud sombra)

El problema de las manuales no es que no se registren: se registran en `historial_ops`.
El problema es que salen **sin `solicitud_id`**, y el historial que ve el usuario se arma
desde `landing_solicitudes`. Para el usuario, esa carga no existió.

**Propuesta:** cuando NODO hace una operación manual, el servidor crea también una
*solicitud sombra* (`origen = 'NODO_MANUAL'`, ya nacida en su estado final) atada al
mismo `codigo_op`. No cambia el laburo del operador —lo hace el servidor— pero el
usuario ve la carga en su historial igual que si la hubiera pedido él.

Esto arregla de una las ~8.858 operaciones por mes que hoy no le llegan a nadie
(MANUAL + ADMIN + DEPO_RECLAMADO + MANUAL_LOCAL + las 568 de LANDING).

---

## 3 · La cola de anotación de Chunior

### Por qué tenés razón en que "no se retoma"

La cola existe ([chunior-verificacion-y-registro.js:110-170](renderer/core/chunior-verificacion-y-registro.js#L110-L170))
y reintenta sola cada 45 s. Pero:

1. **Vive en `localStorage`** (`nodo_chunior_pendientes`), o sea en *esa* PC y *ese*
   perfil. Nadie más la ve, el admi no la ve, y si se reinstala la app se pierde.
2. **Solo 4 de los 12 lugares que anotan en Chunior la usan.** Los que **no** encolan
   cuando Chunior falla:
   - [operaciones-manuales.js:745](renderer/core/operaciones-manuales.js#L745) — **las
     cargas y retiros manuales**. Solo tira un toast rojo y sigue. Esas son las 1.372
     manuales sin N° del mes.
   - [automatizaciones.js:213](renderer/core/automatizaciones.js#L213) — retiro por chat.
   - [lotes-y-solicitudes.js:554](renderer/core/lotes-y-solicitudes.js#L554) — lotes.
   - [chunior-movimientos.js:363](renderer/core/chunior-movimientos.js#L363) — reclamo de depósito.
   - [historial-operaciones.js:409](renderer/core/historial-operaciones.js#L409) y :459 — re-anotación manual.
3. **Se rinde a los 8 intentos** (`if(p.intentos >= 8) continue;`) sin avisarle a nadie.
4. **Corta al primer fallo** (`break`) — con un ítem trabado, los de atrás no salen.
5. **Se saltea si hay cualquier candado tomado.** Y como los candados se cuelgan
   (ver §7), un candado trabado deja la cola congelada sin que nadie lo note.

### Propuesta: no mantener una cola, derivarla

Tu idea es mejor que la cola: **que la lista de pendientes se calcule del historial**,
igual que el progreso de los retiros se calcula de los movimientos reales.

```
pendientes de anotar  :=  historial_ops
                          where estado = 'OK'
                            and chunior_movimiento_id is null
                            and notas not like '%[CHUNIOR_OK_SIN_N]%'
```

Ventajas, todas del mismo argumento que ya usa el código para los parciales:

- **Autocorregible.** No hay contador paralelo que se pueda pudrir. Si se anota, la fila
  deja de aparecer sola.
- **Del lado del servidor.** La ve cualquier PC, la ve el admi, sobrevive a reinstalar.
- **Nada se pierde por no encolar.** No importa cuál de los 12 caminos falló: si la fila
  quedó sin número, aparece. Se elimina de raíz el problema de los 8 call sites.
- **Cambia visualmente al anotarse**, que es justo lo que hoy no pasa.

---

## 4 · Reconciliador de Chunior (el "watchdog de anotaciones")

Mismo criterio y misma cadencia que el watchdog de fichas, en los ratos libres:

1. Levantar la lista de movimientos de Chunior de la ventana horaria.
2. Para cada operación pendiente (§3), buscar candidato por **usuario + monto + ventana
   de tiempo**, con una tolerancia de minutos entre la carga y la anotación.
3. **Un solo candidato sin ambigüedad** → se escribe el `chunior_movimiento_id` y queda
   validado.
4. **Cero o más de uno** → no se toca nada y queda para el operador, marcado como
   "ambiguo". Nunca adivinar: un número de movimiento equivocado es peor que ninguno.
5. Todo lo que decide queda auditado (qué ató, con qué criterio, con qué margen).

El margen de minutos y el "un solo candidato" son la clave: es la misma regla que ya
aplicás a mano cuando cotejás.

---

## 5 · Estados vivos: rescate, cancelación y motivo de rechazo

### Rechazos

En 30 días hubo **4.892 rechazos** (3.281 cargas + 1.611 retiros) y la columna
`cierre_motivo` está en **NULL el 100 % de las veces**. El motivo sí existe, pero
escondido en `metadata.motivo` (4.834 casos), y encima en texto ya redactado para el
usuario:

> "No nos llegó tu transferencia. Revisá el comprobante y volvé a intentar."
> "Sin fichas para retirar (saldo ARS 0.50, confirmado x2)"

O sea: **el mensaje está escrito y nadie se lo muestra.**

**Propuesta:** el rechazo no mata la solicitud, la manda a una **cola de rescate**
(ya existe `rescate_candidatos`, 181.351 filas, para aprovechar). Y en el portal, cuando
el usuario va a subir otra, se le muestra el motivo del rechazo anterior **solo si es del
mismo turno** (misma ventana horaria que la nuestra); si no, pasa de largo.

### Cancelación por el usuario

En 30 días **no hay una sola solicitud en estado `CANCELADA`**. El usuario no puede
cancelar: una vez que subió, para nosotros queda viva para siempre.

**Propuesta:** `PENDIENTE` cancelable por el usuario → `CANCELADA_USUARIO`. Como el
estado vive en el servidor, NODO lo consulta en todo momento: si el usuario cancela, a
nosotros nos desaparece de la bandeja sola, en vez de quedar trabada como ahora.

### Parciales

Hoy cada pago parcial no le llega al usuario (y encima el progreso se guarda en dos
lugares que no se sincronizan — ver D-12). Con `codigo_op` por operación, **cada pago
parcial es su propia fila con su propio código**, y se le avisa al usuario a medida que
sale la plata. El "$ 25.000 de $ 50.000" deja de ser un contador y pasa a ser la suma de
movimientos reales, que es lo único que no se puede corromper.

---

## 6 · Portal: redirección y estado

- Al subir una solicitud → **redirigir a la página de estado**, no dejar al usuario en el
  formulario sin saber qué pasó.
- Esa página muestra el `codigo_op`, el estado actual y, cuando corresponde, el número de
  movimiento de Chunior ya validado.
- Antes de dejarlo subir otra: si la anterior fue rechazada **en el mismo turno**, mostrar
  el motivo primero.

---

## 7 · Los candados que se cuelgan

Hoy hay **nueve** banderas de bloqueo independientes, cada una tomada y soltada por su
cuenta: `_drexGlobalBusy`, `_watchdog.busy`, `_v154pParcialBusy`,
`_portalSolicitudOperacionEnCurso`, `_operacionManualEnCurso`, `_cotejoDeclarando`,
`_drexSinSesion`, `_loteEnCurso` y la cola `_drexCola`.

La solución actual es un botón **Destrabar** que las suelta todas a mano
([chunior-recuperacion-y-transferencias.js:5-22](renderer/core/chunior-recuperacion-y-transferencias.js#L5-L22)).
El comentario del propio código cuenta que antes soltaba cuatro y dejaba cuatro tomadas,
y que por eso se apretaba Destrabar, decía "destrabado", y el panel seguía sin operar.

Eso es un síntoma: si hace falta un botón para destrabar, el candado está mal hecho.

**Propuesta:** un único candado con **dueño, motivo y vencimiento**. Se toma diciendo
quién y para qué, y **se vence solo** a los N segundos. Una operación que se murió a
mitad de camino libera el candado sin que nadie apriete nada, y el que quiera entrar
mientras tanto ve *qué* lo tiene tomado y *desde cuándo*.

---

## 8 · Orden de ejecución propuesto

Cada fase deja el sistema mejor que antes y no depende de que las siguientes existan.

| # | Fase | Qué desbloquea | Riesgo |
|---|---|---|---|
| 1 | `codigo_op` en servidor + backfill | El identificador único de todo | Bajo — columna nueva, nada deja de andar |
| 2 | Pendientes de Chunior derivados del historial (§3) | Mata los 8 call sites que no encolan | Bajo — es una consulta, no cambia escrituras |
| 3 | Candado único con vencimiento (§7) | Que la cola y el watchdog no se congelen | Medio — toca el corazón de la app |
| 4 | Solicitud sombra para manuales (§2) | Que el usuario vea sus 7.898 cargas/mes | Medio — escribe en `landing_solicitudes` |
| 5 | Reconciliador de Chunior (§4) | Recupera los 1.372 sin N° por mes | Medio — lee Chunior, no escribe plata |
| 6 | Motivo de rechazo visible + rescate (§5) | 4.892 rechazos/mes con explicación | Bajo en servidor, medio en el portal |
| 7 | Cancelación por el usuario (§5) | Que no queden trabadas de nuestro lado | Medio — portal + NODO |
| 8 | Parciales notificados (§5) | Cierra D-11/D-12 | Medio |

**Sugerencia:** arrancar por 1, 2 y 3. Las tres son casi todo servidor, se pueden probar
sin tocar el flujo del operador, y solas ya frenan la hemorragia.

---

## 9 · Lo que falta para poder avanzar

- **El código del portal no está en este workspace.** Las fases 6 y 7 son portal puro y no
  las puedo escribir a ciegas. Lo que sí se ve desde el servidor es su contrato: la RPC
  `landing_portal_v16_crear_solicitud`, la tabla `landing_solicitudes` y las 7 rutas de
  `landing_rutas_publicas`.
- **Decidir el formato exacto del `codigo_op`** antes del backfill: cambiarlo después
  implica reescribir 183.895 filas.
- **Confirmar la ventana de tolerancia** del reconciliador (§4): cuántos minutos entre la
  carga y la anotación seguís considerando el mismo movimiento.

---

# 10 · Autoborrado de solicitudes · criterios y riesgos

Pedido: «pasado 3 min la solicitud se elimina sola». Medí qué pasaría. **3 minutos es
demasiado poco**, y para retiros es directamente inviable. Los datos, últimos 7 días:

| Tipo | Total | Resueltas en <3 min | Entre 3 y 15 min | Más de 15 min | Promedio |
|---|---:|---:|---:|---:|---:|
| CARGA | 19.056 | 17.609 (92,4 %) | 1.413 (7,4 %) | 34 (0,2 %) | **1,3 min** |
| RETIRO | 1.269 | 474 (37,4 %) | 405 (31,9 %) | 390 (30,7 %) | **37,9 min** |

Un corte parejo a los 3 minutos mataría **1.447 cargas y 795 retiros por semana** que hoy
terminan bien. En retiros son **dos de cada tres**: el promedio real es de 38 minutos.

## 10.1 · Los tres riesgos, en orden

**1. La plata ya se movió.** Una CARGA dice «ya transferí». Si la solicitud desaparece a los
3 minutos, la transferencia igual ocurrió y no queda pedido de nada. Es el peor final posible
y no lo arregla ningún reintento.

**2. Borrar destruye la evidencia.** Ya tenemos 901 operaciones fallidas que perdieron el
vínculo con su solicitud (D-24). Un `DELETE` empeora exactamente eso. **Nunca borrar: expirar.**
`estado='EXPIRADA'` + `cierre_motivo` + hora. La fila queda para siempre.

**3. El reloj del cliente miente.** El portal calcula el tiempo con `Date.now()` del teléfono.
Un equipo con la hora mal expira lo que no debe. **La expiración la decide el servidor con
`now()`, nunca el navegador.**

## 10.2 · Criterios propuestos

Se expira sólo si se cumplen **todas**:

- Estado todavía abierto (`PENDIENTE`), no final.
- **Ninguna fila en `historial_ops`** para esa solicitud → no se ejecutó nada.
- **Sin mensajes del operador** en el hilo → nadie la está atendiendo.
- **Sin comprobante** subido por el usuario.
- Pasó el tiempo del tipo (abajo).

Tiempos, derivados de la tabla de arriba y no de una intuición:

| Tipo | Propuesta | Por qué |
|---|---|---|
| RETIRO | **90 min** | El promedio es 38 min y el 30,7 % pasa de 15. A 90 min ya es un abandono real. |
| CARGA | **No expirar por tiempo solo** | La plata pudo haber salido. A las 24 h, y sólo si nada se ejecutó, pasa a la **cola de rescate** (§5) — visible, no desaparecida. |
| CAMBIO_CLAVE · SOPORTE | 60 min | Sin riesgo de plata. |

## 10.3 · Lo que hay que arreglar antes

Dos cosas hacen que estos criterios **hoy no se puedan aplicar**:

- **`tomada_por_operador_id` está en NULL en el 100 % de las filas.** El campo existe y nadie
  lo escribe, así que «nadie la tomó» no se puede consultar. Sin eso, el criterio más
  importante no tiene dato. Ver D-26.
- **La guarda antiduplicados de 5 minutos está muerta.** Ver D-25: apunta a la tabla
  equivocada. Conviene arreglarla o retirarla antes de sumar una segunda regla de tiempo,
  porque las dos se pelean: una frena crear la nueva, la otra mata la vieja.

## 10.4 · Qué NO resuelve la expiración

El caso que de verdad trababa el portal —la solicitud fantasma sin número que bloqueaba
cargas y retiros— ya quedó arreglado del lado del cliente (P-02). La expiración sirve para
otra cosa: las que sí se crearon bien y nadie atendió. Es un problema más chico de lo que
parecía.
