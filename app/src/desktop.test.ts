/**
 * The desktop shell's URL handling (ADR 0029): `electron/appPaths.mjs` maps
 * `app://tablemap/…` requests onto the built `dist/` folder and decides
 * which links stay in the app. Pure, so it runs here without Electron.
 */
import path from "node:path";
import {
  APP_ORIGIN,
  APP_START_URL,
  isAppUrl,
  isExternalWebUrl,
  resolveAppFile,
} from "../electron/appPaths.mjs";
import {
  availablePrompt,
  downloadedPrompt,
  releasePageUrl,
  RELEASES_OWNER,
  RELEASES_REPO,
  updateMode,
} from "../electron/updatePolicy.mjs";
import packageJson from "../package.json?raw";

const root = path.resolve("/opt/tablemap/dist");

describe("resolveAppFile", () => {
  it("serves index.html for the root and the start URL, whatever the hash or query", () => {
    expect(resolveAppFile(`${APP_ORIGIN}/`, root)).toBe(path.join(root, "index.html"));
    expect(resolveAppFile(APP_START_URL, root)).toBe(path.join(root, "index.html"));
    expect(resolveAppFile(`${APP_START_URL}#/player`, root)).toBe(path.join(root, "index.html"));
    expect(resolveAppFile(`${APP_START_URL}?x=1#/dm`, root)).toBe(path.join(root, "index.html"));
  });

  it("maps built assets under dist/, decoding escapes", () => {
    expect(resolveAppFile(`${APP_ORIGIN}/assets/index-abc.js`, root)).toBe(
      path.join(root, "assets", "index-abc.js")
    );
    expect(resolveAppFile(`${APP_ORIGIN}/assets/a%20b.png`, root)).toBe(path.join(root, "assets", "a b.png"));
  });

  it("never resolves outside dist/; refuses another host or scheme and malformed URLs", () => {
    const inside = (file: string | null) => file === null || file.startsWith(root + path.sep);
    // Dot segments, plain or escaped, are folded by the URL parser and stay inside.
    expect(resolveAppFile(`${APP_ORIGIN}/../secret.txt`, root)).toBe(path.join(root, "secret.txt"));
    expect(inside(resolveAppFile(`${APP_ORIGIN}/%2e%2e/%2e%2e/etc/passwd`, root))).toBe(true);
    // An escaped slash survives the parser; the containment check refuses it.
    expect(resolveAppFile(`${APP_ORIGIN}/assets/..%2f..%2f..%2fetc%2fpasswd`, root)).toBeNull();
    expect(resolveAppFile(`${APP_ORIGIN}/..%5c..%5cwindows`, root)).toSatisfy(inside);
    expect(resolveAppFile(`${APP_ORIGIN}/a%00b`, root)).toBeNull();
    expect(resolveAppFile(`${APP_ORIGIN}/%E0%A4%A`, root)).toBeNull();
    expect(resolveAppFile("app://elsewhere/index.html", root)).toBeNull();
    expect(resolveAppFile("file:///etc/passwd", root)).toBeNull();
    expect(resolveAppFile("not a url", root)).toBeNull();
  });
});

describe("link routing", () => {
  it("keeps the app's own pages (the player window) in the app", () => {
    expect(isAppUrl(`${APP_START_URL}#/player`)).toBe(true);
    expect(isAppUrl("https://example.com/")).toBe(false);
    expect(isAppUrl("app://elsewhere/")).toBe(false);
    expect(isAppUrl("garbage")).toBe(false);
  });

  it("only hands web links to the system browser", () => {
    expect(isExternalWebUrl("https://example.com/")).toBe(true);
    expect(isExternalWebUrl("http://example.com/")).toBe(true);
    expect(isExternalWebUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalWebUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalWebUrl("garbage")).toBe(false);
  });
});

describe("update policy (ADR 0031)", () => {
  const packaged = { isPackaged: true, env: {} };

  it("installs on Windows, notifies on macOS (unsigned builds cannot self-install), and is off unpackaged or when disabled", () => {
    expect(updateMode({ ...packaged, platform: "win32" })).toBe("install");
    expect(updateMode({ ...packaged, platform: "darwin" })).toBe("notify");
    expect(updateMode({ ...packaged, platform: "linux" })).toBe("notify");
    expect(updateMode({ platform: "win32", isPackaged: false, env: {} })).toBe("off");
    expect(updateMode({ ...packaged, platform: "win32", env: { TABLEMAP_DISABLE_UPDATES: "1" } })).toBe("off");
    expect(updateMode({ ...packaged, platform: "darwin", env: { TABLEMAP_DISABLE_UPDATES: "0" } })).toBe("notify");
  });

  it("points at the release's tag page", () => {
    expect(releasePageUrl("1.2.0")).toBe(`https://github.com/${RELEASES_OWNER}/${RELEASES_REPO}/releases/tag/v1.2.0`);
    expect(releasePageUrl("v1.2.0")).toBe(releasePageUrl("1.2.0"));
  });

  it("reads where the packaged app looks for releases from package.json's publish block", () => {
    const pkg = JSON.parse(packageJson) as { build: { publish: { provider: string; owner: string; repo: string }[] } };
    expect(pkg.build.publish).toEqual([
      expect.objectContaining({ provider: "github", owner: RELEASES_OWNER, repo: RELEASES_REPO }),
    ]);
  });

  it("asks before restarting, defaulting to Later; offers the download on a Mac", () => {
    const ready = downloadedPrompt("1.2.0");
    expect(ready.message).toContain("1.2.0");
    expect(ready.buttons).toEqual(["Restart now", "Later"]);
    expect(ready.defaultId).toBe(1);
    expect(ready.cancelId).toBe(1);
    const available = availablePrompt("1.2.0");
    expect(available.message).toContain("1.2.0");
    expect(available.buttons[0]).toBe("Download");
    expect(available.cancelId).toBe(1);
  });
});
