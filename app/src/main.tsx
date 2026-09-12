import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { CampaignManager } from "./CampaignManager";
import { DmView } from "./dm/DmView";
import { PlayerView } from "./player/PlayerView";

// Hash router so the app also works served from static file hosting / file URLs.
const router = createHashRouter([
  { path: "/", element: <CampaignManager /> },
  { path: "/dm", element: <DmView /> },
  { path: "/player", element: <PlayerView /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
