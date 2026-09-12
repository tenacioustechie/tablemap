/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    // Konva's Node entry (`main`) requires the native `canvas` package; under
    // jsdom we want its browser build instead. react-konva is processed by
    // Vite (not Node) so its bare `import "konva"` goes through this alias.
    alias: [{ find: /^konva$/, replacement: "konva/lib/index.js" }],
    server: { deps: { inline: ["react-konva"] } },
  },
});
