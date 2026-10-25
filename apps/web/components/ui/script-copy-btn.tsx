"use client"

// Magic UI's ScriptCopyBtn (MIT), cut down for one command: no syntax highlighting (shiki) or theme
// hook, and no package-manager tabs, since there is only one install command to show.
import { HTMLAttributes, useState } from "react"
import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface ScriptCopyBtnProps extends HTMLAttributes<HTMLDivElement> {
  command: string
  /** Accessible names of the button, before and after copying. */
  copyLabel?: string
  copiedLabel?: string
  buttonId?: string
  className?: string
}

export function ScriptCopyBtn({
  command,
  copyLabel = "Copy to clipboard",
  copiedLabel = "Copied",
  buttonId,
  className,
  ...props
}: ScriptCopyBtnProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <div className={cn("flex items-center", className)} {...props}>
      <pre className="m-0 min-w-0 grow overflow-hidden font-mono text-ellipsis">
        <code translate="no">{command}</code>
      </pre>
      <Button
        id={buttonId}
        variant="outline"
        size="icon-sm"
        className={cn("relative ml-2 rounded-md", copied && "done")}
        onClick={copyToClipboard}
        aria-label={copied ? copiedLabel : copyLabel}
      >
        <Copy
          className={`h-4 w-4 transition-all duration-300 ${
            copied ? "scale-0" : "scale-100"
          }`}
        />
        <Check
          className={`absolute inset-0 m-auto h-4 w-4 transition-all duration-300 ${
            copied ? "scale-100" : "scale-0"
          }`}
        />
      </Button>
    </div>
  )
}
