import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function usePanelDiagnostics() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const capture = (event: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const panel = document.querySelector<HTMLElement>(".panel");
        const footer = document.querySelector<HTMLElement>(".panel-footer");
        if (!panel || !footer) return;
        const bounds = (el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        };
        void invoke("record_panel_layout", { sample: {
          event,
          viewport: [innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY],
          panel: bounds(panel), footer: bounds(footer),
          backgrounds: [getComputedStyle(panel).backgroundColor, getComputedStyle(footer).backgroundColor],
        } }).catch(() => {});
      }, 200);
    };
    const enter = () => capture("pointer-enter");
    const leave = () => capture("pointer-leave");
    const resize = () => capture("resize");
    const elements = document.querySelectorAll(".panel, .panel-footer");
    elements.forEach(el => { el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave); });
    window.addEventListener("resize", resize);
    capture("opened");
    return () => {
      clearTimeout(timer);
      elements.forEach(el => { el.removeEventListener("mouseenter", enter); el.removeEventListener("mouseleave", leave); });
      window.removeEventListener("resize", resize);
    };
  }, []);
}
