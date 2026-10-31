"use client";

import { useEffect } from "react";
import { calm, onceVisible } from "./motion";

// Each section rises in (opacity and 8 px) the first time it comes on screen.
export function Reveal() {
  useEffect(() => {
    if (calm()) return;
    const sections = [...document.querySelectorAll<HTMLElement>("main > section")];
    const cleanups = sections.map((section) => {
      section.dataset.reveal = "";
      return onceVisible(section, () => { section.dataset.reveal = "in"; }, "0px 0px -8% 0px");
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
  return null;
}
