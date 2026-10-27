"use client"

import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

// AsciiArt — "Code Rain", made with the 21st.dev ASCII editor and baked
// to its exact rendered output (video + poster). Zero dependencies:
// one <video> that fills its parent. Drop it behind or inside your content:
// <div className="relative h-96"><AsciiArt className="absolute inset-0" /></div>
// Remix the source recipe (styles, animation, palette) in the editor:
// https://21st.dev/community/ascii/editor?from=14a45fc1-ebee-47a4-b8d4-772d084815d4
//
// Decorative here: the video only loads once it scrolls into view and plays through once, then rests
// on its last frame. With reduced motion it stays on the poster.
const SRC = "https://assets.21st.dev/ascii-recipes/videos/user_2nElBLvklOKlAURm6W1PTu6yYFh/1783480435681-dnu1ps.mp4"
const POSTER = "https://assets.21st.dev/ascii-recipes/thumbnails/user_2nElBLvklOKlAURm6W1PTu6yYFh/14a45fc1-ebee-47a4-b8d4-772d084815d4.jpg"

export function AsciiArt({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current!
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      io.disconnect()
      video.src = SRC
      video.play().catch(() => {})
    })
    io.observe(video)
    return () => io.disconnect()
  }, [])
  return (
    <video
      ref={ref}
      // Sized by class rather than inline style, so a caller can override the height.
      className={cn("block h-full w-full object-cover", className)}
      poster={POSTER}
      preload="none"
      muted
      playsInline
      aria-hidden="true"
      tabIndex={-1}
    />
  )
}
