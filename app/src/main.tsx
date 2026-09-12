import React from "react";
import ReactDOM from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { routes, routerFuture } from "./routes";

// Hash router so the app also works served from static file hosting / file URLs.
const router = createHashRouter(routes, { future: routerFuture });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>
);
