import { fireEvent, render, screen } from "@testing-library/react";
import { PlayerView } from "./PlayerView";

describe("PlayerView", () => {
  it("renders chrome-free: no headings, buttons, links or DM regions", () => {
    render(<PlayerView />);
    const view = screen.getByTestId("player-view");
    expect(view.style.background).toBe("rgb(0, 0, 0)");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("dm-view")).toBeNull();
    expect(screen.queryByTestId("dm-controls")).toBeNull();
  });

  it("paints the document background black while mounted", () => {
    const { unmount } = render(<PlayerView />);
    expect(document.documentElement.style.background).toBe("rgb(0, 0, 0)");
    unmount();
    expect(document.documentElement.style.background).toBe("");
  });

  it("toggles local fullscreen on F key and double-click", () => {
    const request = vi.fn(async () => undefined);
    const original = document.documentElement.requestFullscreen;
    document.documentElement.requestFullscreen = request;
    try {
      render(<PlayerView />);
      fireEvent.keyDown(window, { key: "f" });
      expect(request).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(window, { key: "x" });
      expect(request).toHaveBeenCalledTimes(1);
      fireEvent.doubleClick(screen.getByTestId("player-view"));
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      document.documentElement.requestFullscreen = original;
    }
  });
});
