# NODO → Nexo · contrato del puente

> Este archivo lo mantiene NODO. El diseño del lado de Nexo vive en NEXO_INTEGRACION.md.

Documento para quien trabaja del lado de **Nexo**. Escrito desde NODO, que es el que produce los
datos. Todo lo que dice "hoy" está verificado contra el código, no es de memoria.

---

## 1. La idea en una línea

**NODO le pasa a Nexo el código de oficina, en toda PC donde Nexo esté instalado.**

Esto corre en las 9 oficinas y en todas funciona igual: cada NODO manda el código de SU oficina.
No hay nada configurado a mano ni atado a una máquina en particular — el mismo instalador de Nexo
sirve en cualquier lado, y se entera de dónde está preguntándole al NODO que tiene al lado.

NODO es el único que sabe la oficina de verdad: la detecta de Chunior cuando el operador se loguea
y elige puesto. No sale de la ruta de instalación ni de un archivo de configuración.

No es una credencial ni un permiso: es un **dato de ruteo**. Sirve para que Nexo sepa a qué oficina
pertenece lo que está mostrando, nada más.

---

## 2. El canal (ya existe, no hay que inventarlo)

NODO es **dueño** del archivo:

```
%APPDATA%\nexo-desktop\shared\nodo-datos.json
```

- Es **JSON plano**, no NDJSON.
- NODO lo **escribe**; Nexo lo **lee y fusiona**. Nexo nunca debe escribirlo.
- Si Nexo no está instalado (no existe `%APPDATA%\nexo-desktop`), NODO no escribe nada y no falla.

Que Nexo lea este archivo **es** el "pedirle la llave a NODO". No hace falta un servidor local ni
IPC: si el archivo está, NODO corrió en esta PC y dejó su oficina ahí.

---

## 3. Lo que Nexo tiene que leer

### 3.1 El código de oficina — lo nuevo

```jsonc
{
  "schemaVersion": 3,
  "pc_codigo": "P4",                            // ← de qué oficina son estos datos
  "generatedAt": "2026-08-08T12:31:00.000Z",    // cuándo lo escribió NODO
  "operador": "juanjulian",                     // quién estaba logueado (referencia)
  "supabase": {                                 // ← a qué servidor apuntar
    "url": "https://pjvvyvfcwjoocjqvdror.supabase.co",
    "key": "sb_publishable_…"
  }
}
```

**Sobre `supabase`: NO lo hardcodees en Nexo.** Hay más de un servidor en juego y se cambia
editando el código de NODO. Si Nexo lo tuviera fijo, al cambiar de servidor quedaría leyendo el
viejo —datos de otra base— sin que nadie se entere. Tomándolo de acá, Nexo siempre habla con el
**mismo** servidor que NODO, sin configurar nada.

La `key` es la *publishable* (anon): ya viaja dentro de la app en cada máquina y está protegida por
RLS. No es un secreto. El secreto de verdad es `PANEL_DATA_SECRET` (el que habilita las RPC
`panel_*`) y **no se manda** — si Nexo necesita algo que lo requiera, se resuelve por otro lado.

En cada oficina llega el suyo: P1, P2, P4… Nexo no tiene que elegir nada ni tener nada precargado,
sólo leer el que le dejó el NODO de esa PC.

Dos detalles prácticos:

1. **Puede cambiar mientras Nexo está abierto.** Si el operador cambia de puesto a mitad de turno,
   NODO reescribe el archivo con el código nuevo. Conviene releerlo en vez de cachearlo al abrir.
2. **Puede venir `null`** si NODO todavía no terminó de loguear. No es un error: es "todavía no sé".
   Lo razonable ahí es esperar al próximo refresco, no asumir una oficina.

### 3.2 Usuarios y operaciones (esto ya lo manda hoy)

Forma REAL del archivo, leída del código (`_nexoBuildPayload`), no de memoria:

```jsonc
{
  "schemaVersion": 3,
  "generatedAt": "2026-08-08T12:31:00.000Z",
  "pc_codigo": "P4",
  "operador": "juanjulian",
  "usuarios": [                       // ← se llama "usuarios", NO "jugadores"
    {
      "alias": "pirataa",             // la clave del join
      "telefono": "3878241553",
      "titular": "Cipriano Jonas Oviedo",
      "portalActivo": true,           // true si alguna vez operó por el portal
      "altaSinOperaciones": false,    // true = alta cargada, todavía sin operar
      "bonos": [ /* … */ ],           // POR USUARIO, no en la raíz
      "operaciones": [
        {
          "ts": 1754500000000,
          "amount": 20000,            // ← se llama "amount". >0 carga · <0 RETIRO
          "tipo": "carga",            // "carga" | "retiro"
          "canal": "portal",          // "portal" | "whatsapp"   ← ver 3.3
          "origen": "PORTAL_V16",     // crudo: PORTAL/LANDING/MANUAL/PANEL/CHAT
          "medio": "MATRELO MP",      // billetera NUESTRA por la que pasó
          "cbu": "",                  // sólo en retiros: alias/CBU del usuario
          "titular": "",              // sólo en retiros: titular de esa cuenta
          "operador": "juanjulian"
        }
      ]
    }
  ]
}
```

**Cuidado con estos cuatro, que son los que se prestan a error:**

1. El array es **`usuarios`**, no `jugadores`.
2. El monto es **`amount`**, no `monto`, y **el signo importa**: los retiros vienen en
   negativo. Si sumás sin mirar el signo, un retiro te resta solo — pero si tomás el valor
   absoluto para "total cargado", inflás las cargas con los retiros.
3. Los **bonos van dentro de cada usuario**, no en la raíz del archivo.
4. El canal manual se llama **`whatsapp`**, no `manual`.

Además:

- El join con lo que Nexo ya tenga es **por `alias`**.
- Deduplicar por **`ts` + `amount`**. NODO ya deduplica de su lado, pero si Nexo fusiona varias
  corridas lo va a necesitar igual.
- Sólo llegan operaciones **efectivas** (estado OK). Las que fallaron no se mandan.
- `cbu` y `titular` a nivel operación vienen **sólo en retiros** — es la cuenta del cliente adonde
  se le transfirió. En las cargas van vacíos.
- Vienen también los usuarios **dados de alta que todavía no operaron** (`altaSinOperaciones:true`),
  para que Nexo tenga la ficha desde el momento del alta.

### 3.3 Portal vs manual — separalos SIEMPRE

Este es el punto que más importa para el CRM y el que se pide explícitamente.

| `canal` | Qué significa | `origen` crudo típico |
|---|---|---|
| `portal` | El jugador operó **solo**, desde la app/portal | `PORTAL`, `PORTAL_V16`, `LANDING` |
| `whatsapp` | Lo cargó **un operador** (WhatsApp, teléfono, a mano) | `MANUAL`, `PANEL`, `CHAT`, `AUTO` |

**Por qué importa:** son dos poblaciones distintas de jugador y no se pueden mezclar en ninguna
métrica. El que opera solo por el portal no necesita atención; el que escribe por WhatsApp cada vez
consume tiempo de operador. Un "top 10 de jugadores" que los mezcla no sirve para decidir nada.

Nexo debería poder:
- filtrar por canal en cualquier vista,
- y mostrar el mix por jugador (ej: "80% portal / 20% manual"), que es la señal de si alguien ya se
  independizó del operador o no.

El campo `canal` ya viene calculado. `origen` va crudo por si Nexo quiere abrir más el abanico.

---

## 4. Etapa 2 — Nexo contra Supabase directo (después, no ahora)

Hoy el puente es de **una sola vía**: NODO escribe, Nexo lee. Nexo no puede consultar ni escribir de
vuelta. Para "consultas cruzadas y cambios cruzados" hay que ir a Supabase directo.

**La buena noticia: la separación por oficina ya está resuelta en el esquema.** Todo está scopeado
por `pc_codigo` y las RPCs lo reciben como parámetro (`p_pc_codigo`). O sea que Nexo **no necesita un
modelo nuevo**: con el `pc_codigo` del punto 3.1 usa las mismas RPCs y respeta la misma separación,
sin lógica propia.

Tabla clave de identidad: `public.usuarios_portal_vinculos`
(`pc_codigo`, `usuario`, `telefono_canon`, `telefono_raw`, `estado_vinculo`, `fuente`).
Estados: `PENDIENTE` · `VINCULADO` · `BLOQUEADO`.

**Cuidado con el usuario "sucio":** los usuarios importados de Whaticket vienen con la oficina
pegada (`martincordoba(pr5)`). En la base hay una función `public._wtk_usuario_limpio(usuario)` y
**hay que compararlos siempre limpios**, nunca crudos. Comparar crudo es exactamente el bug que
tenemos hoy en `panel_vincular_usuario` (ver abajo).

---

## 5. Bug ABIERTO en la base — importa si Nexo va a leer identidades

`panel_vincular_usuario` busca la fila del usuario comparando **crudo**:

```sql
select * into r_exact from public.usuarios_portal_vinculos
 where pc_codigo = v_pc and usuario = v_user limit 1;     -- ← CRUDO
```

mientras que todo el resto de la función compara `public._wtk_usuario_limpio(usuario) = v_user`. Si
la fila guardada tiene el usuario sucio (`26rodri(pr5)`), esa búsqueda no la encuentra, se inserta
una fila NUEVA, y quedan **dos filas para la misma persona**. Después
`landing_portal_resolver_vinculo` puede resolver por la vieja: el jugador sigue entrando con la
identidad con la que se registró la primera vez, aunque un operador lo haya validado.

**Estado: el fix está escrito y SIN APLICAR** (`SQL_fix_vincular_usuario_limpio.sql` en el repo).

Para Nexo esto significa dos cosas:

1. **Hoy hay duplicados en `usuarios_portal_vinculos`.** No asumas que `(pc_codigo, usuario)` es
   único. Para contarlos:

   ```sql
   select pc_codigo, public._wtk_usuario_limpio(usuario) as usuario_limpio,
          count(*) as filas, array_agg(usuario) as variantes
   from public.usuarios_portal_vinculos
   group by 1,2 having count(*) > 1 order by filas desc;
   ```

2. **Compará SIEMPRE con `public._wtk_usuario_limpio(usuario)`, nunca crudo.** Los usuarios
   importados de Whaticket vienen con la oficina pegada. Comparar crudo es exactamente el bug de
   arriba.

## 6. RPCs ya verificadas (leídas del servidor, no supuestas)

- **`landing_retiro_progreso`** — devuelve `ok, total, pagado, restante, pct, estado, pagos`.
  Lee `metadata->'retiro_parcial'` de `landing_solicitudes`. Sirve tal cual; no hay que tocarla.
- **`panel_v15_5_listar_solicitudes_portal`** — filtra por `origen = 'PORTAL_V16'` y ya incluye
  `EN_PROCESO` entre los estados abiertos, así que un retiro parcial no se pierde de la lista.

**Forma del progreso de un retiro parcial** (por si Nexo quiere mostrarlo):

```jsonc
"retiro_parcial": {
  "pagado": 250000, "total": 500000, "restante": 250000,
  "pagos": [
    { "fecha": "2026-08-07T13:19:00.000Z",   // el portal hace new Date(p.fecha)
      "monto": 250000, "restante": 250000,
      "billeteras": ["MATRELO MP"], "operador": "juanjulian" }
  ]
}
```

**Ojo:** ese `pagado` es un contador acumulado y **ya se corrompió una vez** (se contaba doble). La
verdad de cuánto se pagó son las filas de `historial_ops` con ese `solicitud_id`, tipo `RETIRO` y
estado `OK`. Si el número tiene que cerrar, sumá el libro; el metadata sirve para mostrar rápido.

---

## 7. Resumen de lo que se le pide a Nexo

1. Leer `pc_codigo` Y `supabase` de `nodo-datos.json`: la oficina y el servidor salen de ahí, no de un config propio. Llega solo, en cada una de las 9
   oficinas — no hay que configurarlo en ningún lado.
2. Releerlo cada tanto: puede cambiar mientras Nexo está abierto (cambio de puesto).
3. Separar `portal` de `whatsapp` en toda métrica y permitir filtrar por canal.
4. Join por `alias`, dedup por `ts` + `amount`, bonos DENTRO de cada usuario (ver 3.2).
5. Si viene `null` o todavía no hay archivo, esperar al próximo refresco (NODO puede no haber
   terminado de loguear).

---

---

## 8. Pedidos de Nexo → NODO (implementado, APAGADO por defecto)

Nexo no puede escribir identidades: `panel_vincular_usuario` exige `PANEL_DATA_SECRET` y ese
secreto no se comparte. **Nexo encola, NODO aplica.** Ya está hecho del lado de NODO.

**El archivo que NODO lee** (dueño: Nexo, NODO sólo lo lee — no lo borra ni lo reescribe):

```
%APPDATA%\nexo-desktop\shared\nexo-pedidos.json
```

**Qué hace NODO con cada pedido `vincular_telefono`:**

- Llama a `panel_vincular_usuario` con su propio secreto, **sin `p_forzar`**. Si hay conflicto de
  teléfono no lo pisa: lo devuelve como error. Un conflicto de identidad lo resuelve un operador
  mirando el cotejo, no un pedido automático.
- Ignora el archivo entero si su `pc_codigo` no es el de esta oficina.
- Procesa como mucho 200 pedidos por vuelta, en el mismo ciclo que el sync.

**El acuse vuelve en `nodo-datos.json`:**

```jsonc
"pedidosAplicados": [
  { "id": "a3f2c1d4-…", "ok": true,  "error": null, "ts": 1754500100000 },
  { "id": "b7e1f9a2-…", "ok": false, "error": "conflicto: el teléfono es de pepe123", "ts": 1754500101000 }
]
```

Un acuse sale de la cola de NODO recién cuando se escribió de verdad en el archivo. Si entra uno
nuevo mientras se está armando el payload, sale en el próximo en vez de perderse.

### ⚠ Arranca APAGADO

Mientras `panel_vincular_usuario` compare el usuario **crudo** (el bug de la sección 5), cada
pedido puede **duplicar** al usuario en el servidor. Lo pidió el lado de Nexo y tiene razón.

Se prende desde la consola de NODO, **después** de aplicar `SQL_fix_vincular_usuario_limpio.sql`:

```js
window.nexoPedidosActivar(true)    // prende · persiste
window.nexoPedidosActivar(false)   // apaga
```
