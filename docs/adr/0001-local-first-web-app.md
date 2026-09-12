# ADR 0001 — Local-first web app, no backend
Status: accepted

Cross-platform (Windows laptop + friends MacBooks) via the browser; DM/TV split is two browser windows on an extended display; deploys as static files or runs offline. Electron/Tauri rejected for v1 (two-OS packaging cost, no capability we need); a Tauri wrapper can be added later without rewriting. Game engines rejected — this is a UI app, not a game-engine problem.
