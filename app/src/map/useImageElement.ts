/**
 * Turns a Blob into a decoded `HTMLImageElement` for Konva, via an object
 * URL that is revoked when the blob changes or the component unmounts.
 */
import { useEffect, useState } from "react";

export type ImageStatus = "none" | "loading" | "loaded" | "error";

export interface ImageElementState {
  image: HTMLImageElement | null;
  status: ImageStatus;
}

const idle: ImageElementState = { image: null, status: "none" };

export function useImageElement(blob: Blob | undefined | null): ImageElementState {
  const [state, setState] = useState<ImageElementState>(idle);

  useEffect(() => {
    if (!blob) {
      setState(idle);
      return;
    }
    if (typeof URL.createObjectURL !== "function") {
      // jsdom: cannot decode; report and leave the stage without an image.
      setState({ image: null, status: "error" });
      return;
    }
    let cancelled = false;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    setState({ image: null, status: "loading" });
    img.onload = () => {
      if (!cancelled) setState({ image: img, status: "loaded" });
    };
    img.onerror = () => {
      if (!cancelled) setState({ image: null, status: "error" });
    };
    img.src = url;
    return () => {
      cancelled = true;
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [blob]);

  return state;
}
