"use client"

/**
 * ModalAprobarRetiro — aprobación de RETIRO sobre Dialog de shadcn/ui.
 *
 * Mismo Dialog base que ModalAprobarCarga, con las diferencias del flujo real:
 *  - el CBU/alias usa CopyField (patrón CopyButton oficial de shadcn adaptado:
 *    el campo COMPLETO copia con un click, ícono → check + toast "Copiado")
 *  - el TITULAR DE DESTINO tiene la mayor jerarquía tipográfica del modal:
 *    es el dato crítico para no transferir mal
 *  - sin bloque de promociones
 * Identidad: NARANJA/ROJO (egreso de plata).
 */

import * as React from "react"
import { ArrowUpCircle, TriangleAlert } from "lucide-react"
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

import { CopyField } from "./copy-field"
import type { BilleteraOpcion } from "./modal-aprobar-carga"

export interface ModalAprobarRetiroProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  usuario: string
  /** titular de la cuenta DESTINO de la transferencia (dato crítico) */
  titularDestino: string
  /** CBU o alias al que hay que transferir */
  cbuAlias: string
  montoDeclarado: number
  billeteras: BilleteraOpcion[]
  /** billetera de SALIDA pre-seleccionada */
  billeteraId: string
  onAprobar: (datos: { monto: number; billeteraId: string }) => Promise<void> | void
}

const money = (n: number) =>
  n.toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })

export function ModalAprobarRetiro({
  open,
  onOpenChange,
  usuario,
  titularDestino,
  cbuAlias,
  montoDeclarado,
  billeteras,
  billeteraId,
  onAprobar,
}: ModalAprobarRetiroProps) {
  const [monto, setMonto] = React.useState(String(montoDeclarado))
  const [bilId, setBilId] = React.useState(billeteraId)
  const [procesando, setProcesando] = React.useState(false)

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
  const saldoInsuficiente = montoValido && !!bilSel && bilSel.saldo < montoNum

  async function aprobar() {
    if (!montoValido) {
      toast.error("Monto inválido", { description: "Ingresá un monto mayor a cero." })
      return
    }
    setProcesando(true)
    try {
      await onAprobar({ monto: montoNum, billeteraId: bilId })
      toast.success("Retiro aprobado", {
        description: `${usuario} · ${money(montoNum)} → ${titularDestino}`,
      })
      onOpenChange(false)
    } catch (e) {
      toast.error("No se pudo aprobar el retiro", {
        description: e instanceof Error ? e.message : "Error al procesar.",
      })
      setProcesando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !procesando && onOpenChange(o)}>
      <DialogContent className="border-[#30363d] bg-[#0d1117] text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-orange-400">
            <ArrowUpCircle className="size-5" />
            Aprobar retiro
          </DialogTitle>
          <DialogDescription className="text-zinc-500">
            Usuario <span className="font-semibold text-zinc-300">{usuario}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Titular de DESTINO — máxima jerarquía tipográfica: es el dato crítico
            para no transferirle a la persona equivocada */}
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-center">
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Transferir a
          </div>
          <div className="text-2xl font-black leading-tight text-zinc-50">
            {titularDestino || "—"}
          </div>
          <div className="mt-1 text-3xl font-black tabular-nums text-orange-400">
            {money(montoDeclarado)}
          </div>
        </div>

        <div className="grid gap-4 py-1">
          {/* CBU / alias — campo completo copiable con un click (patrón CopyButton) */}
          <CopyField label="CBU / Alias destino" value={cbuAlias} toastMessage="Copiado" />

          {/* Billetera de salida */}
          <div className="grid gap-1.5">
            <Label htmlFor="billetera-salida" className="text-zinc-400">
              Billetera de salida
            </Label>
            <Select value={bilId} onValueChange={setBilId} disabled={procesando}>
              <SelectTrigger
                id="billetera-salida"
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

          {/* Monto a procesar */}
          <div className="grid gap-1.5">
            <Label htmlFor="monto-retiro" className="text-zinc-400">
              Monto a procesar
            </Label>
            <Input
              id="monto-retiro"
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              disabled={procesando}
              className="border-[#30363d] bg-[#161b22] text-lg font-bold tabular-nums text-zinc-100 focus-visible:ring-[#f5c518]/50"
            />
            {!montoValido && monto !== "" && (
              <p className="text-xs text-red-400">El monto tiene que ser un número mayor a cero.</p>
            )}
            {saldoInsuficiente && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                <TriangleAlert className="size-3.5" />
                La billetera {bilSel?.nombre} tiene {money(bilSel!.saldo)} — no alcanza.
              </p>
            )}
          </div>
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
            className="bg-orange-600 font-bold text-white hover:bg-orange-500"
          >
            {procesando ? "Procesando…" : `Aprobar ${montoValido ? money(montoNum) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
