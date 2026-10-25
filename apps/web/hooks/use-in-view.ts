import { useCallback, useEffect, useRef, useState } from "react";

export interface UseInViewOptions {
  /** Stop watching after the first time the element comes into view. */
  once?: boolean;
  /**
   * Grows or shrinks the viewport used for the check, like a CSS margin.
   * `"0px 0px -15% 0px"` waits until the element is 15% above the bottom edge.
   */
  rootMargin?: string;
  /** Fraction of the element that has to be visible, from 0 to 1. */
  amount?: number;
  /** The value before the browser has answered: on the server and on the first render. */
  initial?: boolean;
  /**
   * Called every time the answer changes, with the observer entry. The first
   * call tells you whether the element started out in view.
   */
  onChange?: (inView: boolean, entry?: IntersectionObserverEntry) => void;
}

/**
 * Whether an element is in the viewport, from IntersectionObserver: no scroll
 * listeners, and no work at all while nothing crosses the edge. Put the
 * returned ref on the element.
 *
 * @example
 * const [ref, inView] = useInView({ once: true, amount: 0.3 });
 * return <section ref={ref} data-visible={inView}>…</section>;
 */
export function useInView<T extends Element = Element>({
  once = false,
  rootMargin = "0px",
  amount = 0,
  initial = false,
  onChange,
}: UseInViewOptions = {}) {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(initial);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!node) return;

    // Browsers without IntersectionObserver get the content, not a blank page.
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => {
        setInView(true);
        onChangeRef.current?.(true);
      });
      return () => cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        setInView(entry.isIntersecting);
        onChangeRef.current?.(entry.isIntersecting, entry);
        if (once && entry.isIntersecting) observer.disconnect();
      },
      { rootMargin, threshold: amount }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, once, rootMargin, amount]);

  const ref = useCallback((element: T | null) => setNode(element), []);
  return [ref, inView] as const;
}
