/**
 * Guards the player/DM boundary: nothing under src/player may import from
 * src/dm, nor from the DM store / DM sync publisher. ESLint enforces the same
 * rules; this test makes the acceptance criteria visible in the unit suite.
 */
const sources = import.meta.glob<string>("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const sourceFiles = () =>
  Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));

const offenders = (pattern: RegExp) =>
  sourceFiles()
    .filter(([, code]) => pattern.test(code))
    .map(([path]) => path);

describe("player/dm boundary", () => {
  it("no src/player source file imports from src/dm", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(offenders(/from\s+["'][^"']*\/dm(\/|["'])/)).toEqual([]);
  });

  it("no src/player source file imports the DM store or DM sync publisher", () => {
    expect(offenders(/from\s+["'][^"']*\/state\/(store|dmSync)["']/)).toEqual(
      []
    );
  });

  it("no src/player source file dispatches ops", () => {
    expect(offenders(/\bdispatch\s*\(/)).toEqual([]);
  });
});
