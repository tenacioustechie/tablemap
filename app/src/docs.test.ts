/**
 * Docs are code (T014): the user guide, README and architecture doc must
 * describe the app as built. This suite fails when they drift apart — a
 * renamed npm script, a moved source file, a missing ADR, a button label
 * the guide still quotes, a schema version or dependency list that is out
 * of date. The docs live outside `app/`, so they are read through Vite's
 * glob import like the boundary test reads source text (no Node `fs`).
 */
import { SCHEMA_VERSION } from "./state/model";

// Vite needs the glob options spelled out as a literal at every call site.
const docs = import.meta.glob<string>("../../docs/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const readme = import.meta.glob<string>("../../README.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const harnessReadme = import.meta.glob<string>("../../harness/README.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const packageJson = import.meta.glob<string>("../package.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

// Everything a doc may point at by path: app sources (tests included), e2e
// specs, scripts, the fixture images and the config files at the app root.
const appSources = import.meta.glob<string>("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
});
const e2eSources = import.meta.glob<string>("../e2e/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const scripts = import.meta.glob<string>("../scripts/*.mjs", {
  query: "?raw",
  import: "default",
  eager: true,
});
const appRootFiles = import.meta.glob<string>("../*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const fixtures = import.meta.glob<string>("../e2e/fixtures/*.png", {
  query: "?url",
  import: "default",
  eager: true,
});

function only<T>(glob: Record<string, T>, name: string): T {
  const entries = Object.entries(glob);
  if (entries.length !== 1) throw new Error(`expected exactly one ${name}, got ${entries.length}`);
  return entries[0][1];
}

const docByName = (suffix: string): string => {
  const hit = Object.entries(docs).find(([path]) => path.endsWith(suffix));
  if (!hit) throw new Error(`docs/${suffix} not found`);
  return hit[1];
};

const userGuide = docByName("user-guide.md");
const architecture = docByName("architecture.md");
const adrs = Object.entries(docs).filter(([path]) => path.includes("/adr/"));
const readmeText = only(readme, "README.md");
const harnessReadmeText = only(harnessReadme, "harness/README.md");
const pkg = JSON.parse(only(packageJson, "package.json")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const uiSource = Object.entries(appSources)
  .filter(([path]) => !/\.test\.tsx?$/.test(path))
  .map(([, code]) => code)
  .join("\n");

const knownPaths = [
  // Vite's glob import never includes the importing module itself.
  "./docs.test.ts",
  ...Object.keys(appSources),
  ...Object.keys(e2eSources),
  ...Object.keys(scripts),
  ...Object.keys(appRootFiles),
  ...Object.keys(fixtures),
];

/** `app/src/dm/X.tsx`, `src/dm/X.tsx`, `dm/X.tsx: symbol` and bare `X.tsx` all resolve. */
function pathExists(reference: string): boolean {
  const suffix = reference
    .replace(/^app\//, "")
    .replace(/^src\//, "")
    .replace(/:.*$/, "")
    .trim();
  return knownPaths.some((path) => path.endsWith(`/${suffix}`));
}

const PATH_REFERENCE =
  /^(?:app\/)?(?:src\/)?(?:(?:dm|state|map|player|test|e2e|scripts)\/[\w./-]+|[\w.-]+)\.(?:tsx?|mjs|png)(?::.*)?$/;

/** Every backticked token in `text` that looks like a file path. */
function pathReferences(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = match[1].trim();
    if (PATH_REFERENCE.test(token)) refs.add(token);
  }
  return [...refs];
}

function npmScripts(text: string): string[] {
  return [...new Set([...text.matchAll(/npm run ([a-z0-9:-]+)/g)].map((m) => m[1]))];
}

function adrNumbers(text: string): string[] {
  return [...new Set([...text.matchAll(/ADR (\d{4})/g)].map((m) => m[1]))];
}

const adrExists = (n: string) => adrs.some(([path]) => path.includes(`/adr/${n}-`));

/**
 * The controls the guide's quick start walks a new user through, from a
 * clean clone to a fogged map on the TV. Each must be quoted in the guide
 * exactly as the UI shows it.
 */
const QUICK_START_CONTROLS = [
  "Create campaign",
  "Open player view",
  "Fullscreen player view",
  "Press F in the player window",
  "Import image",
  "Drop image to import a map",
  "Align grid…",
  "Cell size (px)",
  "Calibrate with a ruler…",
  "Use TV size",
  "Reveal",
  "Hide",
  "Brush",
  "Rectangle",
  "Lasso",
  "Hide all",
  "Reveal all",
  "Undo",
  "Blackout",
  "Recentre player view",
  "Export",
  "Import campaign (.zip)",
];

describe("docs match the app", () => {
  it("loads every doc it checks", () => {
    expect(userGuide.length).toBeGreaterThan(1000);
    expect(architecture.length).toBeGreaterThan(1000);
    expect(adrs.length).toBeGreaterThanOrEqual(18);
    expect(knownPaths.length).toBeGreaterThan(50);
  });

  it("README, user guide and harness README only run npm scripts that exist", () => {
    let seen = 0;
    for (const text of [readmeText, userGuide, harnessReadmeText]) {
      for (const name of npmScripts(text)) {
        seen += 1;
        expect(pkg.scripts, `npm run ${name}`).toHaveProperty(name);
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it("architecture.md, the user guide and the ADRs point at files that exist", () => {
    const missing: string[] = [];
    const texts: [string, string][] = [
      ["architecture.md", architecture],
      ["user-guide.md", userGuide],
      ...adrs.map(([path, text]): [string, string] => [path.replace(/^.*\/adr\//, "adr/"), text]),
    ];
    for (const [name, text] of texts) {
      for (const ref of pathReferences(text)) {
        if (!pathExists(ref)) missing.push(`${name}: ${ref}`);
      }
    }
    expect(pathReferences(architecture).length).toBeGreaterThan(30);
    expect(missing).toEqual([]);
  });

  it("every ADR a doc cites exists", () => {
    const cited = new Set<string>();
    for (const text of [architecture, userGuide, readmeText, ...adrs.map(([, t]) => t)]) {
      for (const n of adrNumbers(text)) cited.add(n);
    }
    expect(cited.size).toBeGreaterThan(10);
    expect([...cited].filter((n) => !adrExists(n))).toEqual([]);
  });

  it("architecture.md states the current schema version", () => {
    const stated = architecture.match(/`SCHEMA_VERSION` \((\d+)\)/);
    const current = architecture.match(/`schemaVersion` \(currently (\d+)/);
    expect(stated?.[1]).toBe(String(SCHEMA_VERSION));
    expect(current?.[1]).toBe(String(SCHEMA_VERSION));
  });

  it("architecture.md's approved dependency list is package.json's", () => {
    const section = architecture.split("## Approved dependencies")[1]?.split("\n## ")[0] ?? "";
    const [runtimeLine, devLine] = section.trim().split("\n");
    const approved = runtimeLine
      .replace(/\.$/, "")
      .split(",")
      .map((s) => s.trim())
      .sort();
    expect(approved).toEqual(Object.keys(pkg.dependencies).sort());
    expect(devLine.startsWith("Dev:")).toBe(true);
    const devMissing = Object.keys(pkg.devDependencies)
      .filter((name) => !name.startsWith("@types/"))
      .filter((name) => !devLine.includes(name));
    expect(devMissing).toEqual([]);
  });

  it("the user guide's quick start quotes controls exactly as the UI labels them", () => {
    const notInGuide = QUICK_START_CONTROLS.filter((label) => !userGuide.includes(label));
    const notInUi = QUICK_START_CONTROLS.filter((label) => !uiSource.includes(label));
    expect(notInGuide).toEqual([]);
    expect(notInUi).toEqual([]);
  });

  it("the user guide's table of contents matches its section headings", () => {
    const headings = [...userGuide.matchAll(/^## (\d+\. .+)$/gm)].map((m) => m[1].trim());
    const toc = [...userGuide.matchAll(/^(\d+)\. \[([^\]]+)\]\(#[^)]+\)$/gm)].map(
      (m) => `${m[1]}. ${m[2].trim()}`
    );
    expect(headings.length).toBeGreaterThanOrEqual(8);
    expect(toc).toEqual(headings);
  });

  it("the README's quick start matches the guide's and the app's routes", () => {
    // Both documents send a new user to the same place.
    expect(readmeText).toContain("npm install");
    expect(readmeText).toContain("npm run dev");
    expect(readmeText).toContain("docs/user-guide.md");
    expect(userGuide).toContain("npm run dev");
    // The hash routes the docs quote are the app's.
    for (const text of [readmeText, userGuide]) {
      for (const route of text.matchAll(/`#(\/[a-z]*)`/g)) {
        expect(["/", "/dm", "/player"]).toContain(route[1]);
      }
    }
  });
});
