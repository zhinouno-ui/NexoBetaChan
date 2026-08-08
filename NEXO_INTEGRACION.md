# Nexo ↔ Supabase · reconciliación de identidad

Diseño · 2026-08-08

## El problema

Nexo tiene ~23k contactos armados a mano y por import de CSV/VCF. Supabase tiene el padrón real
de usuarios registrados de cada oficina en `public.usuarios_portal_vinculos` (usuario + teléfono).
Las dos bases hablan de la misma gente pero nadie las cruzó nunca.

El objetivo **no** es traer más datos: es que cada contacto de Nexo quede emparejado con su fila
del servidor, sin duplicar a nadie. Con eso los contactos quedan validados y recién ahí tiene
sentido apoyarse en ellos para reactivación, métricas y campañas.

En paralelo, NODO ya manda por archivo el dato de si cada carga salió del portal o la hizo un
operador. Hoy Nexo lo tira. Es la señal que separa dos poblaciones que no se pueden mezclar en
ninguna métrica.

## Alcance

**Entra:**
- Leer del archivo de NODO lo que hoy se ignora: `canal`, `origen`, `pc_codigo`, `supabase{url,key}`,
  `altaSinOperaciones`, `titular` a nivel usuario.
- Traer el padrón de Supabase de **la oficina propia** y cruzarlo contra los contactos locales.
- Unificar teléfonos según las reglas de abajo, sin destruir datos en ninguna dirección.
- Dejar el canal de escritura Nexo → NODO → Supabase armado del lado de Nexo.

**No entra:**
- Cruzar datos entre oficinas. Bajo ninguna circunstancia.
- Editar `titular` o `estado_vinculo` en el servidor.
- Subir el estado CRM de Nexo a Supabase.
- Aplicar el fix SQL de `panel_vincular_usuario` (es de NODO).

## Decisiones tomadas

| Decisión | Qué se eligió |
|---|---|
| Alcance de oficina | Exclusivamente el `pc_codigo` que manda NODO. Nunca global. |
| Conflicto de teléfono | El de Supabase pasa a principal; el de Nexo baja a `altPhone`. |
| Usuarios del padrón que Nexo no tiene | Se crean como contactos nuevos. |
| Escritura al servidor | Solo para completar huecos, no para pisar. |
| Camino de escritura | Nexo deja el pedido en un archivo, NODO lo aplica con su secreto. |
| Credenciales | Salen de `nodo-datos.json`. Nunca hardcodeadas. |
| Cliente HTTP | `fetch` desde el main process vía IPC. Sin dependencias nuevas. |

### Por qué el cliente va en el main process

Toda la I/O de Nexo ya pasa por `ipcMain` (`nodo:readDatos`, `mirror:write`, `store:*`). Un handler
más sigue el patrón, evita el problema de CORS con origen `null` del renderer `file://`, y mantiene
la key fuera del DOM. PostgREST es HTTP plano, así que **no hace falta `@supabase/supabase-js`** —
sería la primera dependencia de front en una app sin bundler, a cambio de nada.

## Las reglas de teléfono

Son la parte que más importa. Ninguna borra un dato.

| Nexo | Supabase | Resultado |
|---|---|---|
| tiene | tiene, **igual** | Marcar validado. No tocar nada. |
| tiene | tiene, **distinto** | Supabase → `phone`. El de Nexo → `altPhones`. |
| tiene | **no tiene** | Encolar pedido de vinculación hacia el servidor. |
| **no tiene** | tiene | Completar `phone` local. |
| no existe el contacto | tiene | Crear contacto nuevo, marcado `origin: 'portal'`. |

La tercera regla es la única que escribe hacia afuera, así que queda inactiva hasta que la Pieza 3
esté habilitada. Mientras tanto esos casos se cuentan y se muestran, pero no se encolan.

El caso "distinto" merece una nota: la regla vigente de Nexo es que **el teléfono no es identidad**
([nexo-app.js:1896-1898](../../../renderer/nexo-app.js#L1896-L1898)) — un usuario puede cambiar de
número y no se puede inferir cuál es el nuevo. Por eso al fusionar duplicados locales Nexo conserva
los dos números. Acá se sigue el mismo criterio con una diferencia: el de Supabase gana el lugar de
principal, porque es el número con el que el jugador realmente entra al portal.

El `origin: 'portal'` de los contactos creados no es decorativo: permite filtrarlos o borrarlos en
bloque si el padrón resulta ser mucho más grande de lo esperado.

## Pieza 1 — lector de `nodo-datos.json` v3

Sin bloqueos. Se hace primero porque destraba portal vs whatsapp, que es la prioridad declarada.

### Estado actual

El lector es `loadNodoDatos` en [nexo-app.js:1177](../../../renderer/nexo-app.js#L1177). Funciona:
lee `usuarios[]`, dedup por `ts`+`amount`, respeta el signo de los retiros. Lo verificado:

- Los `Math.abs(op.amount)` de las métricas están todos dentro de ramas `op.amount < 0` o
  `isRetiro`, o sea sacan la magnitud de algo ya clasificado. **No hay bug de signo.**
- Lo que **no** captura: `canal`, `origen`, `pc_codigo`, `supabase`, `altaSinOperaciones`, y el
  `titular` a nivel usuario (sí toma el de cada operación).

### Cambios

1. **`canal` y `origen` por operación.** Sumarlos al objeto que se pushea a `opsGranular`
   ([nexo-app.js:1230-1239](../../../renderer/nexo-app.js#L1230-L1239)). Valores de `canal`:
   `portal` | `whatsapp`. Ojo: el doc de NODO usó `manual` en una versión previa y `whatsapp` en la
   actual — aceptar los dos y normalizar a `whatsapp`, para no depender del día en que NODO cambie.

2. **`pc_codigo` en `AppState`.** No cachear al abrir: puede cambiar si el operador cambia de puesto
   a mitad de turno. Puede venir `null` — eso significa "NODO todavía no terminó de loguear", no es
   error. Se espera al próximo refresco, nunca se asume una oficina.

3. **`supabase{url, key}` en `AppState`.** Mismo tratamiento: se relee, no se hardcodea. Si cambia
   la URL, Nexo tiene que seguir a NODO sin rebuild.

4. **`altaSinOperaciones` y `titular` a nivel usuario** → `AppState.nodoUserExtras[aliasNorm]`,
   junto a `bonos` y `portalActivo` que ya se guardan ahí.

5. **Mix de canal por jugador.** Derivar de `opsGranular` el porcentaje portal vs whatsapp y
   exponerlo para la ficha y el filtro.

### Qué se ve

Un filtro por canal en las vistas, y en la ficha el mix ("80% portal / 20% whatsapp"). Es la señal
de si alguien ya se independizó del operador.

## Pieza 2 — traer el padrón (solo lectura)

No tiene bloqueo: las RPCs de lectura no piden secreto.

### RPCs disponibles

Verificadas contra el SQL del repo de NODO, todas `SECURITY DEFINER` con `grant execute … to anon`:

- `panel_crm_vinculos(p_pc_codigos text[])` → `usuario, telefono_canon, titular, estado_vinculo, fuente, updated_at`
- `panel_crm_vinculos_count(p_pc_codigos text[])` → `bigint`
- `panel_crm_vinculos_buscar(p_pc_codigos text[], p_query text, p_limit int)` → lo mismo + `pc_codigo`

Todas aceptan `p_pc_codigos` como array. Nexo siempre manda **un solo elemento**: el `pc_codigo` del
archivo. Nunca `null` (que significaría "todas las oficinas") ni más de uno.

### Paginación — punto a resolver primero

`panel_crm_vinculos` corta a ~1000 filas por el `db-max-rows` de PostgREST y no tiene `ORDER BY`
propio, así que paginar por offset sin orden estable es incorrecto. `panel_crm_vinculos_buscar` sí
ordena por `usuario` pero topea en 200 y no acepta offset.

Plan A: `POST /rest/v1/rpc/panel_crm_vinculos?order=usuario.asc&limit=1000&offset=N`, apoyándose en
que PostgREST aplica `order`/`limit`/`offset` sobre funciones que devuelven `TABLE`. **Hay que
verificarlo contra el servidor real antes de construir encima.**

Plan B si falla: pedirle a NODO una RPC con paginación por keyset (`p_after_usuario`, `p_limit`).

### Componentes

- **`main.js`** — handler `supabase:rpc`. Recibe `{ url, key, fn, params }`, hace
  `POST {url}/rest/v1/rpc/{fn}` con headers `apikey` y `Authorization: Bearer {key}`, devuelve
  `{ ok, data }` o `{ ok:false, message }`. Sin estado, sin credenciales propias: la URL y la key
  llegan en cada llamada desde el renderer, que las sacó del archivo de NODO.
- **`preload.js`** — expone `supabaseRpc` en `electronAPI`.
- **`renderer/supabase-sync.js`** — módulo nuevo. Va en `renderer/` directo, no en
  `renderer/modules/`, siguiendo la convención del proyecto. Trae el padrón, cruza y aplica reglas.
  Se registra en `NexoBridge` como los demás.

### El cruce

Por alias. Del lado de Nexo se usa `normalizeAlias(extractPrimaryAlias(contact.name))`, que es lo
que ya usa `detectDuplicates`. Del lado de Supabase, el `usuario` viene con la oficina pegada en los
importados de Whaticket (`martincordoba(pr5)`), así que hay que limpiarlo con la misma lógica que
`public._wtk_usuario_limpio` antes de comparar. **Comparar crudo es el bug que NODO tiene abierto.**

**No asumir que `(pc_codigo, usuario)` es único.** Por ese mismo bug hoy hay filas duplicadas para
la misma persona. Cuando el padrón traiga dos filas con el mismo usuario limpio, colapsarlas
quedándose con la de `updated_at` más reciente y dejar registro de que había duplicado.

### Cuándo corre

Al abrir, después de `loadNodoDatos` (necesita `pc_codigo` y las credenciales), y con un botón de
"sincronizar ahora". No hay polling: Nexo se congela en segundo plano, un timer periódico no aporta.

## Pieza 3 — escritura vía NODO

`panel_vincular_usuario(p_secret, p_pc_codigo, p_usuario, p_telefono, p_forzar)` exige
`PANEL_DATA_SECRET`, y NODO dice explícitamente que no lo manda. Nexo no puede escribir directo.

Camino elegido: **Nexo encola el pedido en un archivo, NODO lo aplica con su propio secreto.** Nadie
comparte secretos, NODO mantiene control de qué se escribe, y reusa el canal que ya existe (Nexo ya
escribe `nexo-mirror-<pid>.json` y NODO ya lo lee).

### Lo que hace Nexo

Escribe `%APPDATA%\nexo-desktop\shared\nexo-pedidos.json`, atómico (tmp + rename), dueño único:

```jsonc
{
  "schemaVersion": 1,
  "pc_codigo": "P4",
  "generatedAt": "2026-08-08T15:00:00.000Z",
  "pedidos": [
    {
      "id": "a3f2…",                    // uuid, para que NODO pueda acusar recibo
      "tipo": "vincular_telefono",
      "usuario": "pirataa",
      "telefono": "3878241553",
      "ts": 1754500000000
    }
  ]
}
```

Solo se encola el caso "Nexo tiene el teléfono y Supabase no". Nunca un pedido que pise un valor
existente.

### Lo que necesita de NODO

Leer ese archivo, llamar a la RPC con su secreto, y devolver el resultado en `nodo-datos.json`:

```jsonc
"pedidosAplicados": [
  { "id": "a3f2…", "ok": true, "error": null, "ts": 1754500100000 }
]
```

Con el ack Nexo saca el pedido de la cola. Sin ack lo reintenta, que es idempotente.

### Bloqueante previo

El fix `SQL_fix_vincular_usuario_limpio.sql` está escrito y **sin aplicar**. Mientras siga así,
`panel_vincular_usuario` compara el usuario crudo, no encuentra la fila sucia, e **inserta una fila
nueva**. O sea: cada pedido que Nexo mande puede duplicar al usuario en el servidor.

**Nexo no debe encolar ni un pedido hasta que ese fix esté aplicado.** Hasta entonces la Pieza 3
queda escrita pero apagada detrás de un flag.

## Riesgos

**El padrón puede inflar la base.** `usuarios_portal_vinculos` tiene 53k filas entre las 9 oficinas.
No sabemos cuántas son de P4. Si son 10k, Nexo crea 10k contactos de un saque, la mayoría sin
actividad. Mitigación: contar con `panel_crm_vinculos_count` **antes** de traer nada y avisar cuántos
se van a crear; el `origin: 'portal'` permite revertir en bloque.

**El cruce por alias puede fallar.** `normalizeAlias` de Nexo y `_wtk_usuario_limpio` de Supabase no
son la misma función. Aliases que difieren solo en decoración pueden no matchear y generar un
contacto duplicado. Mitigación: sobre una muestra, medir cuántos del padrón matchean antes de crear
nada, y revisar los no-matcheados a mano.

**Un `pc_codigo` equivocado escribe en la oficina que no es.** Mitigación: si `pc_codigo` viene
`null` o vacío, no se hace ninguna llamada — ni de lectura.

## Verificación

- Con un `nodo-datos.json` de ejemplo v3, confirmar que `canal`, `origen`, `pc_codigo` y `supabase`
  llegan a `AppState`, y que el mix por jugador da lo esperado.
- Confirmar que `pc_codigo: null` no dispara ninguna llamada.
- Contra el servidor real: que `?order=&limit=&offset=` pagine bien `panel_crm_vinculos` y que la
  suma de páginas cuadre con `panel_crm_vinculos_count`.
- Sobre una muestra de 100 del padrón, medir la tasa de match por alias antes de crear contactos.
- Que las cuatro reglas de teléfono no borren ningún número en ninguna dirección.

## Orden

1. Pieza 1 completa. Es independiente y destraba lo priorizado.
2. Verificar paginación y tasa de match contra el servidor real.
3. Pieza 2.
4. Pieza 3, detrás de un flag, recién cuando NODO aplique el fix SQL.
