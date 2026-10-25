"use client"

import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

// Amber Dusk: a diamond lattice of glyphs in the accent colour, brightest along the rings around the
// centre and fading into a vignette. A diagonal band of light sweeps across once when it scrolls into
// view (600 ms), then it holds still. Recreated from the 21st.dev ASCII recipe's description.
const RAMP = " .·:◇◆"
const CELL = 12 // px per glyph column
const SWEEP = 600 // ms

export function AmberDusk({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext("2d")!
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let raf = 0
    let started = 0

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
      if (canvas.height !== Math.round(height * dpr)) canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const style = getComputedStyle(canvas)
      ctx.fillStyle = style.color
      ctx.font = `${CELL}px ${style.getPropertyValue("--glyph") || "monospace"}`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"

      const cols = Math.ceil(width / CELL)
      const rows = Math.ceil(height / (CELL * 1.4))
      // Sweep position: from before the left edge to past the right one, along x + y.
      const t = reduced ? 1 : Math.min(1, (now - started) / SWEEP)
      const band = -0.3 + t * 1.6
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const u = (i + 0.5) / cols, v = (j + 0.5) / rows
          const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2
          // Diamond rings (Manhattan distance), faded towards the edges.
          const d = Math.abs(dx) * 1.6 + Math.abs(dy)
          const ring = 0.5 + 0.5 * Math.cos(d * 9)
          const vignette = Math.max(0, 1 - (dx * dx + dy * dy) * 0.55)
          let value = ring * vignette
          if (t < 1) value += Math.max(0, 1 - Math.abs((u * 0.7 + v * 0.3) - band) * 8) * 0.8
          const k = Math.min(RAMP.length - 1, Math.floor(value * RAMP.length))
          if (k === 0) continue
          ctx.globalAlpha = 0.2 + 0.8 * Math.min(1, value)
          ctx.fillText(RAMP[k], (i + 0.5) * CELL, (j + 0.5) * CELL * 1.4)
        }
      }
      if (t < 1) raf = requestAnimationFrame(draw)
    }

    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      io.disconnect()
      started = performance.now()
      raf = requestAnimationFrame(draw)
    })
    io.observe(canvas)
    // The lattice depends on the size; redraw the settled frame when it changes.
    const ro = new ResizeObserver(() => { if (started) { cancelAnimationFrame(raf); draw(started + SWEEP) } })
    ro.observe(canvas)
    return () => { io.disconnect(); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])
  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none block h-full w-full text-primary", className)} />
}
