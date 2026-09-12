/** Player view: render-only, chrome-free. Never imports from src/dm/. */
export function PlayerView() {
  return (
    <main
      data-testid="player-view"
      style={{ width: "100vw", height: "100vh", background: "#000" }}
    />
  );
}
