"use client";

import { useEffect, useMemo, useRef, type ComponentProps, type Ref } from "react";

import { useEntrance, type EntranceTrigger } from "@/hooks/use-entrance";
import { cn } from "@/lib/utils";

function mergeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const NBSP = "\u00a0";

/**
 * When each character settles, in ms after the start: a sweep from the left,
 * scattered a little so it reads as decoding rather than typing. The
 * scatter comes from the position, so every run of the same text matches.
 */
function settleTimes(glyphs: string[], gap: number) {
  return glyphs.map((_, index) => {
    const scatter = Math.sin(index * 7.31 + glyphs.length * 1.7) * 0.5 + 0.5;
    return (index + scatter * 2.5) * gap;
  });
}

/** The line at a moment: settled characters as they are, the rest as noise. Spaces stay spaces. */
function frame(glyphs: string[], elapsed: number, times: number[], characters: string) {
  return glyphs
    .map((glyph, index) =>
      /\s/.test(glyph) || elapsed >= (times[index] ?? 0)
        ? glyph
        : characters[Math.floor(Math.random() * characters.length)]
    )
    .join("");
}

// Fresh noise at most this often, so it flickers rather than smears.
const NOISE_EVERY = 45;

interface ScrambleTextProps extends Omit<ComponentProps<"span">, "children"> {
  /** Plain text. */
  children: string;
  /** Milliseconds between one character settling and the next. */
  speed?: number;
  /** Wait before it starts, in ms. */
  delay?: number;
  /** The noise it cycles through before the text settles. */
  characters?: string;
  /** "load" starts as soon as the page runs; "in-view" when the text scrolls into view. */
  trigger?: EntranceTrigger;
  /** In-view: play the first time only. */
  once?: boolean;
  /** Takes over from `trigger`: `false` holds it blank, `true` runs it. */
  play?: boolean;
}

/**
 * Text that decodes itself: the line starts as noise and the real
 * characters settle into place in a loose sweep from the left. It writes straight to the DOM once
 * per frame instead of re-rendering React. The text is in the server HTML
 * for search engines and for browsers without JavaScript, screen readers
 * get it in one piece, and with `prefers-reduced-motion` it just appears.
 * A monospace font (the default) keeps the width steady while it runs.
 *
 * @example
 * <ScrambleText className="text-sm">Signal acquired</ScrambleText>
 */
function ScrambleText({
  children: text,
  speed = 40,
  delay = 0,
  characters = "01<>[]{}/\\|=~^",
  trigger = "load",
  once = true,
  play,
  className,
  ref,
  ...props
}: ScrambleTextProps) {
  const [observe, phase] = useEntrance<HTMLSpanElement>({ trigger, once, play });
  const mergedRef = useMemo(() => mergeRefs(ref, observe), [ref, observe]);
  const output = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = output.current;
    if (!node) return;
    // Change the value of React's own text node rather than replacing it,
    // so React's later updates still land on the node that is on screen.
    const write = (value: string) => {
      const child = node.firstChild;
      if (child?.nodeType === Node.TEXT_NODE) child.nodeValue = value;
      else node.textContent = value;
      node.style.visibility = "visible";
    };
    const settle = () => write(text);
    if (phase === "static" || prefersReducedMotion()) return settle();
    if (phase === "armed") return write(NBSP.repeat(Math.max(text.length, 1)));

    const glyphs = Array.from(text);
    const times = settleTimes(glyphs, Math.max(speed, 1));
    const end = Math.max(0, ...times);
    const noise = characters || "#";
    const start = performance.now() + delay;
    let written = -Infinity;
    let id = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed >= end) return settle();
      if (elapsed >= 0 && now - written >= NOISE_EVERY) {
        written = now;
        write(frame(glyphs, elapsed, times, noise));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [phase, text, speed, delay, characters]);

  return (
    <span
      ref={mergedRef}
      data-slot="scramble-text"
      data-state={phase}
      className={cn("inline-block font-mono whitespace-pre-wrap", className)}
      {...props}
    >
      <span className="sr-only">{text}</span>
      {/* Hidden until the script takes over when it is about to play, so the text does not flash; shown as is without JavaScript. */}
      <span
        ref={output}
        aria-hidden="true"
        data-slot="scramble-text-output"
        className={cn(phase === "play" && "[@media(scripting:enabled)]:invisible")}
      >
        {text}
      </span>
    </span>
  );
}

export { ScrambleText, type ScrambleTextProps };
