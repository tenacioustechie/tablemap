/**
 * Guards the player/DM boundary: nothing under src/player may import from
 * src/dm. ESLint enforces the same rule; this test makes the acceptance
 * criterion visible in the unit suite.
 */
const sources = import.meta.glob<string>("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("player/dm boundary", () => {
  it("no src/player source file imports from src/dm", () => {
    const files = Object.entries(sources).filter(
      ([path]) => !/\.test\.tsx?$/.test(path)
    );
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter(([, code]) => /from\s+["'][^"']*\/dm(\/|["'])/.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
