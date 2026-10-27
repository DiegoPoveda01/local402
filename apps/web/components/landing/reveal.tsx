"use client";

import { useEffect } from "react";
import { calm, onceVisible, scramble } from "./motion";

// Each section fades up the first time it comes on screen, and its title decodes in.
export function Reveal() {
  useEffect(() => {
    if (calm()) return;
    const sections = [...document.querySelectorAll<HTMLElement>("main > section, #jurado")];
    const cleanups = sections.map((section) => {
      section.dataset.reveal = "";
      return onceVisible(section, () => {
        section.dataset.reveal = "in";
        const title = section.querySelector("h2");
        if (title?.offsetParent) scramble(title);
      }, "0px 0px -8% 0px");
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
  return null;
}
