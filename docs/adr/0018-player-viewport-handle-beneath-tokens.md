# ADR 0018: The player viewport rectangle's drag handle lives beneath the tokens

Status: accepted (T013)

## Context
ADR 0014 draws the player viewport rectangle in the DM stage's top (controls) layer as a fill-less Konva `Rect` in a draggable group, and notes that Konva hit-tests the whole interior of a fill-less shape. T010 made tokens draggable in the token layer, which sits below the fog. The T013 session test — calibrate, then drag a token that stands inside the TV area — showed the two combined: once the display is calibrated the rectangle is draggable and covers exactly what the TV shows, so every drag that starts on a token inside it moved the rectangle instead. On a map smaller than the TV the rectangle covers the whole map and no token can be moved at all. Neither T009 nor T010 had an e2e test combining calibration with tokens.

## Decision
- **Split looks from hit-testing.** `PlayerViewportFrame` (stroke, TV-top bar, label) stays in the controls layer, above the fog, with `listening={false}`. `PlayerViewportHandle`, an invisible fill-less `Rect` in a draggable group of the same size and position, goes in a new `MapStage` layer — `underlay`, drawn between the grid and the tokens. Hit-testing is by z-order, so a press on a token hits the token, a press anywhere else inside the rectangle hits the handle, and a press outside both hits the stage (drag-pan of the DM canvas), as before.
- **Keep the whole interior grabbable.** Rejected: a border-only hit band (`hitFunc`) — on a map smaller than the TV the border is off the map and often off the canvas, and a 2 px line is a poor handle; also rejected: forwarding the press from the rectangle to the token underneath through Konva's drag registry, which depends on the order of Konva's internal and React's listeners and on `stopDrag` semantics.
- The `underlay` prop is generic ("interactive nodes tokens must win over"), like `controls`; the player never passes it.

## Consequences
- The DM stage has seven canvases with a scene shown (Konva warns above five; the T008 4k brush-drag perf smoke still passes its frame budget). The unit tests' canvas counts changed accordingly.
- Dragging the rectangle from its centre (the T009 e2e) still works when no token is there; `e2e/session.spec.ts` asserts a token inside the rectangle moves and the rectangle's centre does not.
- User guide: a drag that starts on a token moves the token; anywhere else inside the rectangle pans the player view.
