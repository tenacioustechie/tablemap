import type { RouteObject } from "react-router-dom";
import { CampaignManager } from "./CampaignManager";
import { DmView } from "./dm/DmView";
import { PlayerView } from "./player/PlayerView";
import { ROUTE_CAMPAIGNS, ROUTE_DM, ROUTE_PLAYER } from "./routePaths";

/** Route table shared by the real app (hash router) and tests (memory router). */
export const routes: RouteObject[] = [
  { path: ROUTE_CAMPAIGNS, element: <CampaignManager /> },
  { path: ROUTE_DM, element: <DmView /> },
  { path: ROUTE_PLAYER, element: <PlayerView /> },
];

/** Opt in to v7 behaviour now so the eventual upgrade is a no-op. */
export const routerFuture = { v7_relativeSplatPath: true } as const;
