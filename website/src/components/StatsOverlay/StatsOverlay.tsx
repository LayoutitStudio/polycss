import { useEffect, useRef } from "react";
import Stats from "stats-js/src/Stats.js";

const FPS_SAMPLE_MS = 1000;
const MS_SAMPLE_MS = 500;

export function StatsOverlay(): null {
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 760px)");
    let statsContainer: HTMLDivElement | null = null;
    let fpsPanel: Stats.StatsPanel | null = null;
    let msPanel: Stats.StatsPanel | null = null;
    let lastFrame = 0;
    let fpsSampleStart = 0;
    let msSampleStart = 0;
    let fpsFrameCount = 0;
    let maxFrameMs = 0;

    const stop = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      statsContainer?.remove();
      statsContainer = null;
      fpsPanel = null;
      msPanel = null;
    };

    const start = () => {
      if (statsContainer) return;
      lastFrame = performance.now();
      fpsSampleStart = lastFrame;
      msSampleStart = lastFrame;
      fpsFrameCount = 0;
      maxFrameMs = 0;
      statsContainer = document.createElement("div");
      statsContainer.className = "dn-stats-overlay";
      statsContainer.setAttribute("aria-hidden", "true");
      statsContainer.style.position = "fixed";
      statsContainer.style.right = "12px";
      statsContainer.style.bottom = "12px";
      statsContainer.style.zIndex = "30";
      statsContainer.style.top = "auto";
      statsContainer.style.left = "auto";
      statsContainer.style.display = "flex";
      statsContainer.style.alignItems = "flex-end";
      statsContainer.style.gap = "2px";
      statsContainer.style.opacity = "0.9";
      statsContainer.style.pointerEvents = "none";

      fpsPanel = new Stats.Panel("FPS", "#0ff", "#002");
      msPanel = new Stats.Panel("MS", "#0f0", "#020");
      statsContainer.append(fpsPanel.dom, msPanel.dom);

      document.body.appendChild(statsContainer);

      const tick = (now: number) => {
        const frameMs = Math.max(0, now - lastFrame);
        lastFrame = now;
        fpsFrameCount += 1;
        if (frameMs > maxFrameMs) maxFrameMs = frameMs;

        const msElapsed = now - msSampleStart;
        if (msElapsed >= MS_SAMPLE_MS && statsContainer) {
          msPanel?.update(maxFrameMs, 200);
          msSampleStart = now;
          maxFrameMs = 0;
        }

        const fpsElapsed = now - fpsSampleStart;
        if (fpsElapsed >= FPS_SAMPLE_MS && statsContainer) {
          const fps = (fpsFrameCount * 1000) / fpsElapsed;
          fpsPanel?.update(fps, 100);
          fpsSampleStart = now;
          fpsFrameCount = 0;
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
