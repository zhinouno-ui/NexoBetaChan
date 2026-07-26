# Modales de aprobación (shadcn/ui) — NODO

Nueva versión de los modales de aceptación de **cargas** y **retiros**, construida
sobre los componentes oficiales de shadcn/ui (Radix + Tailwind) sin reescribir su
lógica interna (foco, teclado, accesibilidad).

> ⚠️ Estos componentes son React/TSX: **no se pueden enchufar directo en
> `NODO · OPERATIVO LITE.htm`** (vanilla JS). Van en el proyecto React que tenga
> shadcn instalado (portal / próxima UI del panel). Reemplazan al modal viejo:
> mismos datos de entrada, misma salida (`onAprobar({ monto, billeteraId })`).

## Instalación de los componentes base

```bash
npx shadcn@latest add dialog select badge input button label sonner
npm i lucide-react
```

Y el `<Toaster />` de Sonner una sola vez en el layout raíz:

```tsx
import { Toaster } from "@/components/ui/sonner"
// …
<Toaster theme="dark" />
```

## Archivos

| Archivo | Qué es |
|---|---|
| `modal-aprobar-carga.tsx` | Modal de CARGA — acento **verde** (ingreso). Monto declarado grande, titular, Select de billetera destino (con Badge `VINCULADO` y saldo), Input "Monto a procesar" pre-cargado, bloque de promo/bono (patrón Alert, acento verde, % + billetera de acreditación). |
| `modal-aprobar-retiro.tsx` | Modal de RETIRO — acento **naranja/rojo** (egreso). Titular de DESTINO con máxima jerarquía tipográfica, CBU/alias copiable con un click, sin promos, aviso de saldo insuficiente en la billetera de salida. |
| `copy-field.tsx` | `CopyField`: el patrón **CopyButton oficial de shadcn** (apps/www/components/copy-button.tsx) adaptado — el campo completo copia al click, ícono Copy→Check 2s, toast "Copiado" vía Sonner. |

## Paleta

Overrides de color sobre los componentes (no un rediseño): fondo `#0d1117`,
superficies `#161b22`, bordes `#30363d`, acento de marca `#f5c518` (amarillo NODO,
usado en focus rings y Badge VINCULADO), verde esmeralda para carga, naranja para retiro.

## Uso

```tsx
const [openCarga, setOpenCarga] = React.useState(false)

<ModalAprobarCarga
  open={openCarga}
  onOpenChange={setOpenCarga}
  usuario="juanp123"
  titular="Juan Pérez"
  montoDeclarado={5000}
  billeteras={[
    { id: "b1", nombre: "MP Naranja", saldo: 152300, vinculada: true },
    { id: "b2", nombre: "MP Azul",    saldo: 43100 },
  ]}
  billeteraId="b1"
  promo={{ porcentaje: 20, billeteraNombre: "Cuenta Bonos" }}
  onAprobar={async ({ monto, billeteraId }) => {
    // misma lógica que el modal actual: procesar la carga con el monto
    // (editado o no) y la billetera elegida. Si tira, el modal muestra
    // el error por Sonner y NO se cierra.
    await procesarCarga(monto, billeteraId)
  }}
/>

<ModalAprobarRetiro
  open={openRetiro}
  onOpenChange={setOpenRetiro}
  usuario="juanp123"
  titularDestino="JUAN PABLO PÉREZ"
  cbuAlias="juan.perez.mp"
  montoDeclarado={12000}
  billeteras={billeteras}
  billeteraId="b1"
  onAprobar={async ({ monto, billeteraId }) => {
    await procesarRetiro(monto, billeteraId)
  }}
/>
```

## Comportamiento clavado al modal actual

- Cancelar cierra sin efectos; `Escape` y click afuera también (deshabilitados
  mientras procesa, para no cortar una aprobación en vuelo).
- Aprobar deshabilitado con monto inválido; muestra el monto final en el botón.
- `onAprobar` puede ser async: el modal queda en "Procesando…" y solo se cierra
  si resuelve OK; si rechaza, toast de error y el modal queda abierto.
- El monto acepta coma o punto decimal (es-AR).
