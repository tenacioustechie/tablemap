import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes, routerFuture } from "./routes";

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, {
    initialEntries: [path],
    future: routerFuture,
  });
  return render(
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  );
}

describe("routes", () => {
  it("/ renders the campaign manager", () => {
    renderRoute("/");
    expect(screen.getByRole("heading", { name: "TableMap" })).toBeTruthy();
    expect(screen.queryByTestId("dm-view")).toBeNull();
    expect(screen.queryByTestId("player-view")).toBeNull();
  });

  it("/dm opens a campaign, then renders the DM view", async () => {
    renderRoute("/dm");
    expect(await screen.findByTestId("dm-view")).toBeTruthy();
    expect(screen.queryByTestId("player-view")).toBeNull();
  });

  it("/player renders the player view", () => {
    renderRoute("/player");
    expect(screen.getByTestId("player-view")).toBeTruthy();
    expect(screen.queryByTestId("dm-view")).toBeNull();
  });
});
