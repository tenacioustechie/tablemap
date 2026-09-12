import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlayerView } from "./player/PlayerView";
import { DmView } from "./dm/DmView";

describe("smoke", () => {
  it("renders the player view chrome-free", () => {
    render(<PlayerView />);
    expect(screen.getByTestId("player-view")).toBeTruthy();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the DM view", () => {
    render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <DmView />
      </MemoryRouter>
    );
    expect(screen.getByTestId("dm-view")).toBeTruthy();
  });
});
