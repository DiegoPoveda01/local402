// Motion helpers shared by the landing: reduced motion, font readiness and the decode ("scramble") effect.

export const calm = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The layout's inline script races the web fonts against 2 s; the page and its animations wait for it.
export const fontsReady = (): Promise<unknown> => (globalThis as { fontsReady?: Promise<unknown> }).fontsReady ?? Promise.resolve();

// Titles and figures decode in: every letter or digit cycles through random glyphs and settles, left to right.
// Screen readers get the final text from the start; the serif words (em) stay put.
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#%&*+=<>/";
const scrambling = new Map<Element, () => void>();
export function scramble(el: Element | null | undefined, duration = 500) {
  if (!el || calm()) return;
  scrambling.get(el)?.();
  const nodes: [Text, string][] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest("em") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  while (walker.nextNode()) nodes.push([walker.currentNode as Text, (walker.currentNode as Text).data]);
  const total = nodes.reduce((sum, [, text]) => sum + text.length, 0);
  if (!total) return;
  const label = el.getAttribute("aria-label");
  el.setAttribute("aria-label", el.textContent?.trim() ?? "");
  let stopped = false;
  // Puts the real text back, at the end or when something else (a language switch, a new quote) takes over.
  const finish = () => {
    stopped = true;
    scrambling.delete(el);
    for (const [node, text] of nodes) node.data = text;
    if (label === null) el.removeAttribute("aria-label");
    else el.setAttribute("aria-label", label);
  };
  scrambling.set(el, finish);
  const started = performance.now();
  const frame = (now: number) => {
    if (stopped) return;
    const t = (now - started) / duration;
    if (t >= 1) return finish();
    let offset = 0;
    for (const [node, text] of nodes) {
      node.data = [...text].map((c, i) => ((offset + i) / total < t || !/[\p{L}\p{N}]/u.test(c) ? c
        : /\d/.test(c) ? String((Math.random() * 10) | 0) : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
      offset += text.length;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
// React owns these text nodes: every decode is settled before it renders new text into them.
export const finishScrambles = () => { for (const finish of [...scrambling.values()]) finish(); };

// Runs once, the first time the element is on screen (after the fonts, so nothing decodes in a fallback font).
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
