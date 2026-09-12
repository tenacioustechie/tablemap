/** Player view: render-only, chrome-free. Never imports from src/dm/. */
import { useEffect } from "react";
import { isFullscreenKey, toggleLocalFullscreen } from "./fullscreen";

export function PlayerView() {
  useEffect(() => {
    const root = document.documentElement;
    const previousBackground = root.style.background;
    root.style.background = "#000";

    const onKeyDown = (event: KeyboardEvent) => {
      if (isFullscreenKey(event)) void toggleLocalFullscreen();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      root.style.background = previousBackground;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <main
      data-testid="player-view"
      onDoubleClick={() => void toggleLocalFullscreen()}
      style={{
        width: "100vw",
        height: "100vh",
        background: "#000",
        overflow: "hidden",
        cursor: "none",
      }}
    />
  );
}
