/**
 * Tracks the pixel size of an element so the Konva stage can fill it. Uses
 * ResizeObserver where available (falls back to window resize events, e.g.
 * under jsdom).
 */
import { useLayoutEffect, useState, type RefObject } from "react";
import type { Size } from "./viewport";

export function useContainerSize(ref: RefObject<HTMLElement>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height }
      );
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref]);

  return size;
}
