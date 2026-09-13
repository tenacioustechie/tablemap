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

// The shared stage (T101): it may not draw walls either, so the DM's wall
// layer must stay out of `src/map/` as well as `src/player/`.
const mapSources = import.meta.glob<string>("../map/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const nonTest = (glob: Record<string, string>) =>
  Object.entries(glob).filter(([path]) => !/\.test\.tsx?$/.test(path));

const sourceFiles = () => nonTest(sources);

const offenders = (pattern: RegExp, files = sourceFiles()) =>
  files.filter(([, code]) => pattern.test(code)).map(([path]) => path);

describe("player/dm boundary", () => {
  it("no src/player source file imports from src/dm", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(offenders(/from\s+["'][^"']*\/dm(\/|["'])/)).toEqual([]);
  });

  it("no src/player source file imports the DM store, DM sync publisher or storage", () => {
    expect(
      offenders(
        /from\s+["'][^"']*\/state\/(store|dmSync|db|persistence|autosave|session|calibrationSession|fogActions|fogHistory|splashActions|tokenActions|annotationActions|campaignArchive)["']/
      )
    ).toEqual([]);
  });

  it("no src/player source file dispatches ops or sends pings", () => {
    expect(offenders(/\bdispatch\s*\(/)).toEqual([]);
    expect(offenders(/\bsendPing\s*\(/)).toEqual([]);
  });

  it("no src/player source file knows about notes (T011: notes are DM-only)", () => {
    // The player never draws a note: the stage's annotation layer draws
    // drawings only, and the DM's publisher strips notes before they leave
    // the DM window. Keep it that way in the source too.
    expect(offenders(/\bkind\s*===?\s*["']note["']/)).toEqual([]);
    expect(offenders(/NoteAnnotation|notesOf\b|NoteMarker/)).toEqual([]);
  });

  it("neither src/player nor src/map imports the DM's wall layer (T101: walls are data on the player, never drawn)", () => {
    expect(nonTest(mapSources).length).toBeGreaterThan(0);
    const wallRender = /WallLayer|WallNode|from\s+["'][^"']*\/dm\/WallLayer["']/;
    expect(offenders(wallRender)).toEqual([]);
    expect(offenders(wallRender, nonTest(mapSources))).toEqual([]);
    // Nor does either draw a segment by hand: nothing reads a wall's endpoints.
    expect(offenders(/\.x1\b|\.y2\b/)).toEqual([]);
    expect(offenders(/\.x1\b|\.y2\b/, nonTest(mapSources))).toEqual([]);
  });
});
