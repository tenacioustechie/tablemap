# ADR 0002 — Konva (Canvas 2D) for map rendering
Status: accepted

Layered canvas, hit detection and dragging built in; fog is natural via destination-out compositing. PixiJS (WebGL) deferred — revisit only if profiling shows Canvas 2D cannot hold 60 fps brush drag on the target hardware.
