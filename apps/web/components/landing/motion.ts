// Motion helpers shared by the landing: reduced motion, font readiness, the number tween and the on-screen trigger.
import { useEffect, useRef, useState } from "react";

export const calm = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The layout's inline script races the web fonts against 2 s; the page and its animations wait for it.
export const fontsReady = (): Promise<unknown> => (globalThis as { fontsReady?: Promise<unknown> }).fontsReady ?? Promise.resolve();

// Eases a number from its last value to the new one in 300 ms; with reduced motion it jumps straight there.
export function useTween(target: number | undefined, duration = 300) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === undefined || from.current === undefined || calm()) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = from.current;
    const started = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - t) ** 3;
      const next = start + (target - start) * eased;
      from.current = next;
      setValue(t < 1 ? next : target);
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

// Runs once, the first time the element is on screen (after the fonts, so nothing moves in a fallback font).
export function onceVisible(el: Element, run: () => void, rootMargin?: string) {
  let observer: IntersectionObserver | undefined;
  let cancelled = false;
  fontsReady().then(() => {
    if (cancelled) return;
    observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer?.disconnect();
      run();
    }, { rootMargin });
    observer.observe(el);
  });
  return () => { cancelled = true; observer?.disconnect(); };
}
