"use client"

/**
 * ModalAprobarCarga — aprobación de CARGA sobre Dialog de shadcn/ui.
 *
 * Usa los componentes oficiales tal cual (Dialog/Select/Badge/Input/Sonner);
 * los colores son overrides por className, no se toca su lógica interna de
 * foco/teclado/accesibilidad. Identidad: VERDE (ingreso de plata).
 *
 * Comportamiento (idéntico al modal actual del panel):
 *  - muestra monto declarado, titular y billetera destino (nombre + saldo)
 *  - "Monto a procesar" editable, pre-cargado con el monto declarado
 *  - Select para cambiar la billetera destino
 *  - bloque de promo/bono (si hay) con % y billetera donde se acredita
 *  - Cancelar cierra sin tocar nada; Aprobar entrega { monto, billeteraId }
 */

import * as React from "react"
import { ArrowDownCircle, Gift } from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface BilleteraOpcion {
  id: string
  nombre: string
  saldo: number
  /** true si la billetera está vinculada a Chunior (muestra el Badge VINCULADO) */
  vinculada?: boolean
}

export interface PromoCarga {
  /** porcentaje del bono, ej. 20 */
  porcentaje: number
  /** billetera/cuenta donde se acredita el bono */
  billeteraNombre: string
}

export interface ModalAprobarCargaProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: string
  titular: string
  montoDeclarado: number
  billeteras: BilleteraOpcion[]
  /** billetera pre-seleccionada (la que detectó el panel) */
  billeteraId: string
  promo?: PromoCarga | null
  /** Aprobar: recibe el monto final (editado o no) y la billetera elegida */
  onAprobar: (datos: { monto: number; billeteraId: string }) => Promise<void> | void
}

const money = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })

export function ModalAprobarCarga({
  open,
  onOpenChange,
  usuario,
  titular,
  montoDeclarado,
  billeteras,
  billeteraId,
  promo,
  onAprobar,
}: ModalAprobarCargaProps) {
  const [monto, setMonto] = React.useState(String(montoDeclarado))
  const [bilId, setBilId] = React.useState(billeteraId)
  const [procesando, setProcesando] = React.useState(false)

  // re-sincronizar cuando se abre para otra solicitud
  React.useEffect(() => {
    if (open) {
      setMonto(String(montoDeclarado))
      setBilId(billeteraId)
      setProcesando(false)
    }
  }, [open, montoDeclarado, billeteraId])

  const bilSel = billeteras.find((b) => b.id === bilId)
  const montoNum = Number(String(monto).replace(",", "."))
  const montoValido = Number.isFinite(montoNum) && montoNum > 0

  async function aprobar() {
    if (!montoValido) {
      toast.error("Monto inválido", { description: "Ingresá un monto mayor a cero." })
      return
    }
    setProcesando(true)
    try {
      await onAprobar({ monto: montoNum, billeteraId: bilId })
      toast.success("Carga aprobada", {
        description: `${usuario} · ${money(montoNum)} · ${bilSel?.nombre ?? ""}`,
      })
      onOpenChange(false)
    } catch (e) {
      toast.error("No se pudo aprobar la carga", {
        description: e instanceof Error ? e.message : "Error al procesar.",
      })
      setProcesando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !procesando && onOpenChange(o)}>
      <DialogContent className="border-[#30363d] bg-[#0d1117] text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-400">
            <ArrowDownCircle className="size-5" />
            Aprobar carga
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Usuario <span className="font-semibold text-zinc-300">{usuario}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Monto declarado — dato principal, texto grande */}
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-4 py-3 text-center">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Monto declarado
          </div>
          <div className="text-3xl font-black tabular-nums text-emerald-400">
            {money(montoDeclarado)}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            Titular: <span className="font-medium text-zinc-200">{titular || "—"}</span>
          </div>
        </div>

        <div className="grid gap-4 py-1">
          {/* Billetera destino */}
          <div className="grid gap-1.5">
            <Label htmlFor="billetera" className="text-zinc-400">
              Billetera destino
            </Label>
            <Select value={bilId} onValueChange={setBilId} disabled={procesando}>
              <SelectTrigger
                id="billetera"
                className="border-[#30363d] bg-[#161b22] focus:ring-[#f5c518]/50"
              >
                <SelectValue placeholder="Elegí una billetera" />
              </SelectTrigger>
              <SelectContent className="border-[#30363d] bg-[#161b22] text-zinc-100">
                {billeteras.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      {b.nombre}
                      <span className="tabular-nums text-zinc-500">{money(b.saldo)}</span>
                      {b.vinculada && (
                        <Badge className="border-transparent bg-[#f5c518]/15 text-[10px] font-bold text-[#f5c518]">
                          VINCULADO
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Monto a procesar (editable, pre-cargado) */}
          <div className="grid gap-1.5">
            <Label htmlFor="monto" className="text-zinc-400">
              Monto a procesar
            </Label>
            <Input
              id="monto"
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={procesando}
              className="border-[#30363d] bg-[#161b22] text-lg font-bold tabular-nums text-zinc-100 focus-visible:ring-[#f5c518]/50"
            />
            {!montoValido && monto !== "" && (
              <p className="text-xs text-red-400">El monto tiene que ser un número mayor a cero.</p>
            )}
          </div>

          {/* Promo / bono — patrón visual del Alert de shadcn con acento verde */}
          {promo && promo.porcentaje > 0 && (
            <div
              role="alert"
              className="relative w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm"
            >
              <div className="flex items-start gap-3">
                <Gift className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                <div>
                  <div className="font-semibold text-emerald-300">
                    Bono {promo.porcentaje}% activo
                  </div>
                  <div className="mt-0.5 text-zinc-400">
                    {montoValido && (
                      <>
                        Acredita{" "}
                        <span className="font-bold tabular-nums text-emerald-300">
                          {money(Math.round((montoNum * promo.porcentaje) / 100))}
                        </span>{" "}
                        extra en{" "}
                      </>
                    )}
                    <span className="font-medium text-zinc-200">{promo.billeteraNombre}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={procesando}
            onClick={() => onOpenChange(false)}
            className="border-[#30363d] bg-transparent text-zinc-300 hover:bg-[#161b22] hover:text-zinc-100"
          >
            Cancelar
          </Button>
          <Button
            disabled={procesando || !montoValido}
            onClick={aprobar}
            className="bg-emerald-600 font-bold text-white hover:bg-emerald-500"
          >
            {procesando ? "Procesando…" : `Aprobar ${montoValido ? money(montoNum) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
