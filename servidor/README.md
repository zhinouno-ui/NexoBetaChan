# Lo que corre en el servidor

Buena parte del sistema **no está en el código de la app**: vive en el proyecto Supabase
**NODO** (`pjvvyvfcwjoocjqvdror`). Esta carpeta es una copia de lectura, para que no haya
que entrar a la base para saber qué hay. El bot se buscó en git más de una vez, y en git
no está ni estuvo nunca.

> **La fuente de verdad son las migraciones de Supabase, no estos archivos.**
> Acá hay una foto de las **53 funciones**, tomada el **2026-09-05** con `pg_get_functiondef`, verificada función
> por función comparando el md5 del cuerpo contra la base. No se aplican con `psql` a
> ciegas: si hay que cambiar algo, va por migración.

## El bot de soporte — [`bot-soporte.sql`](bot-soporte.sql)

Lo que contesta solo en el chat del portal. **8 funciones.**

`trg_soporte_autorespuesta` es un **BEFORE INSERT en `landing_solicitudes`** para
`tipo='SOPORTE'`. Llama a `soporte_auto_mensaje_v1`, que es una función *pura*: decide qué
decir y, si no hay nada cierto que decir, no contesta.

La respuesta se escribe en `metadata.chat_thread` de la misma fila, como un mensaje con
`origen='OPERADOR'`, `operador='NODO'`, `auto=true`. Marcas que deja en `metadata`:

| marca | qué significa |
|---|---|
| `auto_respondido_at` | contestó de verdad |
| `auto_caso` | qué caso detectó (`COMPROBANTE`, `ESTADO_CARGA`, `RECHAZO_RETIRO`, …) |
| `auto_espejo` | **no** contestó: solo anotó qué habría dicho |
| `auto_omitido` | se calló por repetido (mismo caso, misma persona, < 3 min) |

Dos frenos que importan: `DERIVAR_HUMANO` (angustia / adicción) devuelve caso **sin
mensaje**, para que lo tome una persona; y todo el trigger está dentro de un
`exception when others then return new`, así que un error del bot nunca voltea el insert.

**Ojo:** el comentario de la función dice *"Solo P4"* y está **desactualizado** —
`v_reales` es `P1..P7`. Al 30/08 contestaba en las 7 oficinas.

## CRM y reconexión — [`crm-reconexion.sql`](crm-reconexion.sql) · [`crm-perfil-y-vinculos.sql`](crm-perfil-y-vinculos.sql)

**17 funciones.** La cola de reconexión por turno con detección de duplicados
(Levenshtein), el marcado de intentos, la unificación de alias, los dormidos, la
prevalidación antes de crear un usuario, y el motor del CRM (`panel_crm_perfil_v1`:
score, segmento, billetera y operador habitual — todo calculado en la base).

Todas piden `p_secret` y validan contra `PANEL_DATA_SECRET`.

### La cola de rescate (4/9)

`panel_reconexion_cola` salía sola de `historial_ops`, que arranca en julio: todo el que
dejó de cargar antes era invisible, así que la cola mostraba gente reciente y de poco valor
y los operadores la vaciaron en tres días. `panel_rescate_cola` la reemplaza cruzando las
operaciones importadas de Agentes contra NODO y ordenando por lo que depositó cada uno.

No se calcula al vuelo: sale de la tabla **`rescate_candidatos`**, que `rescate_refrescar`
rearma entera cada 30 minutos por `pg_cron` (job 8). La rearma en una temporal y recién al
final reemplaza, dentro de la misma transacción — si falla a mitad, las colas siguen
andando con datos de hace media hora en vez de quedar vacías.

`panel_rescate_tomar` reserva el contacto a nombre del operador por 30 minutos y usa tabla
aparte (**`reconexion_reservas`**) a propósito: marcarlo en `reconexion_contactos` lo haría
figurar como "ya trabajado" y desaparecería de la cola vieja sin que nadie lo contactara.
La reserva vence sola, para que nadie deje contactos bloqueados al irse del turno.

## Whaticket y monitor — [`whaticket-y-monitor.sql`](whaticket-y-monitor.sql)

**11 funciones.** Resolver quién escribe por WhatsApp, qué contactos faltan agendar, el
estado de las líneas, el latido de cada panel, y los normalizadores compartidos
(`nodo_norm_usuario_v21` lo usa el bot para comparar usuarios: tocarlo afecta a todo).

## Edge Functions — [`edge-functions/`](edge-functions/)

Las 6 que hay, en TypeScript. Valen la pena leerlas: los comentarios documentan
incidentes reales.

| función | qué hace |
|---|---|
| `whaticket-webhook.ts` | recibe los mensajes de WhatsApp. **Fase de escucha: no contesta nada**, solo registra. Es la única sin JWT (Whaticket no lo sabe mandar); la puerta es `?k=`. |
| `whaticket-agendar.ts` | agenda los contactos que faltan. Trae un **candado de oficina** porque el 25/8 se cargó el token de P3 creyendo que era P4 y se crearon 155 contactos en la agenda equivocada. El 4/9 el candado pasó a ser **relativo** (gana la pedida y le saca 3x a la segunda) porque el 40% fijo dejaba afuera a P5, que vincula poca gente y daba 21,7% siendo la cuenta correcta — y pasó a correr **antes** del espejo, que hasta entonces escribía 300 contactos sin que nadie hubiera validado de quién era la cuenta. |
| `whaticket-traer.ts` | espeja la agenda. El flag `hasMore` de la API **miente**: se trajo el 31% de P4 dando la agenda por completa. Ahora corta por dos páginas vacías seguidas. |
| `whaticket-lineas.ts` | monitor de líneas caídas. Whaticket no avisa: hay que preguntarle. |
| `whaticket-sonda.ts` | verifica un token nuevo antes de escribir nada. Desde el 4/9 recibe `{"pc"}` en vez de mirar solo P4, y prueba 7 endpoints para saber **qué se puede leer** con ese token — sobre todo si `/tickets` y `/messages` contestan, que es de lo que depende poder auditar las conversaciones. |
| `whaticket-sonda-editar.ts` | temporal: prueba si la API ya permite editar contactos. |

## Admi · tableros — [`admin-tablero.sql`](admin-tablero.sql) · [`admin-tablero-grandes.sql`](admin-tablero-grandes.sql)

**17 funciones.** Son del Admi (`admi-V23-COMPLETO-con-whaticket.html`), no del panel operativo:
embudo de usuarios, crecimiento, monitor, operación en vivo, rendimiento de operadores,
movimientos manuales de plata con señales de revisión, y el tablero por oficina.

`admin_od_rescate_v1` (4/9) es el control de la cola de rescate: cuánto hay en cola por
oficina, quién la trabaja, cuánta plata volvió, y una medición de **cómo escriben** los
operadores (largo del mensaje, cortesía, arranque en minúscula). Incluye `atribucion`:
cuántas respuestas del chat quedaron con nombre y cuántas cayeron al genérico `panel`.

El control de acceso está en `admin_od_scope_effective`: rol ADMIN o scope ALL ve todas las
oficinas; a un encargado se le fuerza la suya, ignorando lo que pida.

**Cuidado:** las tres grandes (`dashboard_resumen`, `crecimiento_resumen`, `operacion_vivo`)
NO pasan por `admin_od_scope_effective` — solo validan la sesión con `nodo_admin_session_ok`.
El acotado por oficina se lo ponen sus envoltorios `*_v2`. **Llamarlas directo saltea ese
control** y devuelve datos de todas las oficinas.

## Lo que NO está copiado acá

- **Los helpers internos** `_panel_data_auth`, `_panel_crm_auth`, `_panel_crm_*_raw`,
  `_panel_resolver_puesto_raw`, `admin_get_scope`, `nodo_admin_session_ok`.
- **Las tablas.** `whaticket_eventos`, `whaticket_lineas`, `whaticket_contactos_stage`,
  `reconexion_contactos`, `usuarios_portal_eventos`, `vinculo_cambio_telefono`,
  `panel_actividad`, `portal_acceso_links`, `rescate_candidatos`, `reconexion_reservas`.

## Los cron jobs (`pg_cron`)

Son cuatro. Ninguno está en git: se ven con `select jobid, schedule, command from cron.job`.

| cada | qué corre | por qué importa |
|---|---|---|
| 10 min | `whaticket-lineas` | Whaticket no avisa cuando una línea se cae: hay que preguntarle. |
| 15 min | `soporte_vincular_automatico_v1('P4', '2 hours', false)` | **solo P4**, no las 7 oficinas. |
| 30 min | `whaticket-agendar` | sin `pc`: le toca **una** oficina por corrida, rotando por reloj. La cadencia tiene que coincidir con `ROTACION_MS` de la función. |
| 30 min | `rescate_refrescar()` | rearma `rescate_candidatos`, de donde sale la cola de rescate. |

Los dos que llaman Edge Functions lo hacen con `net.http_post` y la anon key en el header.
**`net.http_post` solo confirma que despachó el pedido, no que la función haya terminado**:
por eso un cron puede figurar en verde mientras la función muere en 504 — ya pasó, y estuvo
dos días sin sincronizar sin que se notara.

## Para bajar todo esto como corresponde

Con la CLI (no está instalada en esta máquina):

```bash
supabase login
supabase link --project-ref pjvvyvfcwjoocjqvdror
supabase db pull                       # esquema + migraciones
supabase functions download whaticket-agendar
```

## Dato importante

Las migraciones de Supabase llegan hasta el **04/09** (once ese día, casi todas de rescate:
`rescate_cola_y_reservas` … `rescate_cola_join_indexable`), y las Edge Functions
`whaticket-agendar` y `whaticket-sonda` se redeployaron ese mismo día.

El repo no es la foto completa del sistema. Si algo "falta", mirá acá antes que en git.
Las funciones de rescate son el caso claro: el panel v1.1.82 las llama, pero el SQL que las
crea nunca pasó por un commit.

## Cómo chequear si esta copia quedó vieja

Sin re-bajar nada: se le pide a la base el md5 del cuerpo de cada función y se compara
contra estos archivos. Lo que difiere es lo único que hay que traer.

```sql
select proname,
       md5(replace(prosrc, chr(13), '')) as md5_cuerpo,
       length(prosrc)                    as largo
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname ~ '^(_?soporte|trg_soporte|whaticket|panel_|nodo_norm|reconexion_clase|admin_od)'
 order by proname;
```

El 03/09 ese chequeo dio: 47 idénticas, 2 cambiadas, 0 nuevas, 0 borradas.
El 05/09: **49 idénticas, 0 cambiadas, 4 nuevas** (`panel_rescate_cola`, `panel_rescate_tomar`,
`rescate_refrescar`, `admin_od_rescate_v1`), 0 borradas.

Ojo con el `regexp` de esa consulta: `rescate_refrescar` **no** empieza con ninguno de esos
prefijos y no aparece. Al agregar familias nuevas hay que ampliarlo, o se pierden funciones
sin que el chequeo diga nada.
