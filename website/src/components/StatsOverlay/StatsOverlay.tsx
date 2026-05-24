import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";

export function StatsOverlay(): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    let statsContainer: HTMLDivElement | null = null;
    let stats: Stats[] = [];

    const stop = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      statsContainer?.remove();
      statsContainer = null;
      stats = [];
    };

    const start = () => {
      if (statsContainer) return;
      statsContainer = document.createElement("div");
      statsContainer.className = "dn-stats-overlay";
      statsContainer.style.position = "fixed";
      statsContainer.style.right = "12px";
      statsContainer.style.bottom = "12px";
      statsContainer.style.zIndex = "30";
      statsContainer.style.top = "auto";
      statsContainer.style.left = "auto";
      statsContainer.style.display = "flex";
      statsContainer.style.alignItems = "flex-end";

      stats = [0, 1, 2].map((mode) => {
        const stat = new Stats();
        stat.setMode(mode);
        stat.dom.style.position = "static";
        stat.dom.style.pointerEvents = "none";
        statsContainer!.appendChild(stat.dom);
        return stat;
      });

      document.body.appendChild(statsContainer);

      const tick = () => {
        for (const stat of stats) {
          stat.update();
        }
        frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    };

    const sync = () => {
      if (mobileQuery.matches) {
        stop();
      } else {
        start();
      }
    };

    sync();
    mobileQuery.addEventListener("change", sync);
    return () => {
      mobileQuery.removeEventListener("change", sync);
      stop();
    };
  }, []);

  return null;
}
