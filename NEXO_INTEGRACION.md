# Nexo ↔ NODO · cómo tiene que funcionar el puente

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
  "schemaVersion": 2,
  "pc_codigo": "P4",                            // ← de qué oficina son estos datos
  "generatedAt": "2026-08-07T09:31:00.000Z",    // cuándo lo escribió NODO
  "operador": "juanjulian"                      // quién estaba logueado (referencia)
}
```

En cada oficina llega el suyo: P1, P2, P4… Nexo no tiene que elegir nada ni tener nada precargado,
sólo leer el que le dejó el NODO de esa PC.

Dos detalles prácticos:

1. **Puede cambiar mientras Nexo está abierto.** Si el operador cambia de puesto a mitad de turno,
   NODO reescribe el archivo con el código nuevo. Conviene releerlo en vez de cachearlo al abrir.
2. **Puede venir `null`** si NODO todavía no terminó de loguear. No es un error: es "todavía no sé".
   Lo razonable ahí es esperar al próximo refresco, no asumir una oficina.

### 3.2 Jugadores y operaciones (esto ya lo manda hoy)

```jsonc
{
  "jugadores": [
    {
      "alias": "pirataa",
      "telefono": "3878241553",
      "titular": "Cipriano Jonas Oviedo",
      "portalActivo": true,
      "operaciones": [
        {
          "ts": 1754500000000,
          "monto": 20000,
          "tipo": "carga",            // "carga" | "retiro"
          "canal": "portal",          // ← ver 3.3
          "origen": "PORTAL_V16"      // origen crudo, por si querés más granularidad
        }
      ]
    }
  ],
  "bonos": [ /* van aparte, NO como operaciones */ ]
}
```

- El join con lo que Nexo ya tenga es **por `alias`**.
- Deduplicar por **`ts` + `monto`**. NODO ya deduplica de su lado, pero si Nexo fusiona varias
  corridas lo va a necesigar igual.
- Sólo llegan operaciones **efectivas** (estados OK). Las que fallaron no se mandan.
- Los **bonos van en su propio array**, nunca mezclados con `operaciones`.

### 3.3 Portal vs manual — separalos SIEMPRE

Este es el punto que más importa para el CRM y el que se pide explícitamente.

| `canal` | Qué significa | `origen` crudo típico |
|---|---|---|
| `portal` | El jugador operó **solo**, desde la app/portal | `PORTAL`, `PORTAL_V16`, `LANDING` |
| `manual` | Lo cargó **un operador** (WhatsApp, teléfono, a mano) | `MANUAL`, `PANEL`, `CHAT`, `AUTO` |

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

## 5. Bug abierto del lado de NODO/SQL (contexto, no es de Nexo)

`panel_vincular_usuario` busca la fila del usuario con:

```sql
select * into r_exact from public.usuarios_portal_vinculos
 where pc_codigo = v_pc and usuario = v_user limit 1;     -- ← CRUDO
```

pero en todos los demás lados compara `public._wtk_usuario_limpio(usuario) = v_user`. Si la fila
guardada tiene el usuario sucio, esa búsqueda no la encuentra, se inserta una fila nueva y quedan
**dos filas para la misma persona**. Después `landing_portal_resolver_vinculo` puede resolver por la
vieja, y el jugador sigue entrando con la identidad con la que se registró la primera vez.

Se arregla usando `_wtk_usuario_limpio` también ahí. Lo menciono porque si Nexo va a leer esa tabla,
tiene que saber que hoy puede haber duplicados.

---

## 6. Resumen de lo que se le pide a Nexo

1. Leer `pc_codigo` de `nodo-datos.json` y usarlo como scope. Llega solo, en cada una de las 9
   oficinas — no hay que configurarlo en ningún lado.
2. Releerlo cada tanto: puede cambiar mientras Nexo está abierto (cambio de puesto).
3. Separar `portal` de `manual` en toda métrica y permitir filtrar por canal.
4. Join por `alias`, dedup por `ts` + `monto`, bonos aparte.
5. Si viene `null` o todavía no hay archivo, esperar al próximo refresco (NODO puede no haber
   terminado de loguear).
