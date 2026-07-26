"use client"

/**
 * CopyField — adaptación del CopyButton oficial de shadcn
 * (github.com/shadcn-ui/ui/blob/main/apps/www/components/copy-button.tsx).
 *
 * Diferencia con el original: acá el CAMPO COMPLETO es clickeable (no solo un
 * ícono chico) — pensado para copiar el CBU/alias de un retiro con un solo
 * click sin apuntarle a un botoncito. Mantiene el mismo comportamiento:
 * navigator.clipboard + estado copied con reset a los 2s + ícono Copy→Check,
 * y suma el toast "Copiado" vía Sonner (nada de alert()).
 */

import * as React from "react"
import { CheckIcon, ClipboardIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

export async function copyToClipboardWithMeta(value: string) {
  await navigator.clipboard.writeText(value)
}

interface CopyFieldProps extends React.HTMLAttributes<HTMLButtonElement> {
  value: string
  /** Etiqueta chica arriba del valor (ej: "CBU / Alias destino") */
  label?: string
  /** Mensaje del toast — default "Copiado" */
  toastMessage?: string
}

export function CopyField({
  value,
  label,
  toastMessage = "Copiado",
  className,
  ...props
}: CopyFieldProps) {
  const [hasCopied, setHasCopied] = React.useState(false)

  React.useEffect(() => {
    if (!hasCopied) return
    const t = setTimeout(() => setHasCopied(false), 2000)
    return () => clearTimeout(t)
  }, [hasCopied])

  return (
    <button
      type="button"
      onClick={async () => {
        await copyToClipboardWithMeta(value)
        setHasCopied(true)
        toast(toastMessage, { description: value })
      }}
      className={cn(
        // campo completo clickeable, look de input pero con affordance de botón
        "group flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left font-mono text-sm transition-colors",
        "border-[#30363d] bg-[#161b22] text-zinc-100",
        "hover:border-[#f5c518]/60 hover:bg-[#1c2128]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5c518]/50",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">
        {label && (
          <span className="mb-0.5 block font-sans text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {label}
          </span>
        )}
        <span className="block truncate">{value}</span>
      </span>
      <span className="sr-only">Copiar</span>
      {hasCopied ? (
        <CheckIcon className="size-4 shrink-0 text-emerald-400" />
      ) : (
        <ClipboardIcon className="size-4 shrink-0 text-zinc-500 group-hover:text-[#f5c518]" />
      )}
    </button>
  )
}
