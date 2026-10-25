import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { useInView } from "@/hooks/use-in-view";

export type EntranceTrigger = "load" | "in-view";

/**
 * - `static`: show the content as it is, with no animation.
 * - `armed`: hold the content in its starting state, waiting to play.
 * - `play`: run the entrance.
 */
export type EntrancePhase = "static" | "armed" | "play";

export interface UseEntranceOptions {
  /**
   * "load" plays on first paint, from CSS alone, so it suits text above the
   * fold and needs no JavaScript. "in-view" waits until the element scrolls
   * into view.
   */
  trigger?: EntranceTrigger;
  /** In-view: play the first time only. Otherwise it rearms off screen and plays again. */
  once?: boolean;
  /** In-view: fraction of the element that has to be visible, from 0 to 1. */
  amount?: number;
  /** Takes over from `trigger`: `false` holds the content in its starting state, `true` plays it. */
  play?: boolean;
}

const subscribe = () => () => {};

/**
 * Decides when a one-shot entrance runs. Components render their start
 * state for `armed` and their animation for `play`, both behind
 * `motion-safe`, so with `prefers-reduced-motion` the content simply shows.
 *
 * Server-rendered content is never hidden before the browser has checked
 * where it is: if it is already on screen it stays `static` (use "load" for
 * that), so nothing blinks while the page hydrates. Elements first rendered
 * in the browser (a dialog, a tab, a remount) start `armed` and play as
 * soon as they are seen.
 *
 * @example
 * const [ref, phase] = useEntrance<HTMLSpanElement>({ trigger: "in-view" });
 * return <span ref={ref} data-state={phase}>…</span>;
 */
export function useEntrance<T extends Element = Element>({
  trigger = "in-view",
  once = true,
  amount = 0.3,
  play,
}: UseEntranceOptions = {}) {
  // False while hydrating server HTML, true for elements first rendered in the browser.
  const browserRender = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const [phase, setPhase] = useState<EntrancePhase>(() => {
    if (trigger === "load") return "play";
    return browserRender ? "armed" : "static";
  });
  const answered = useRef(false);
  const watching = trigger === "in-view" && play === undefined;

  const onChange = useCallback(
    (inView: boolean) => {
      const first = !answered.current;
      answered.current = true;
      setPhase((current) => {
        if (inView) return current === "armed" ? "play" : current;
        // Rendered on the server but below the fold: hide it until it is reached.
        if (current === "static" && first) return "armed";
        if (current === "play" && !once) return "armed";
        return current;
      });
    },
    [once]
  );

  const [observe, inView] = useInView<T>({ amount, onChange: watching ? onChange : undefined });

  const current: EntrancePhase = play === undefined ? phase : play ? "play" : "armed";
  return [observe, current, inView] as const;
}
