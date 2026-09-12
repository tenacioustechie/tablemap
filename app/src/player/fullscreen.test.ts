import { isFullscreenKey, toggleLocalFullscreen } from "./fullscreen";

function fakeDoc(initiallyFullscreen: boolean, reject = false) {
  const doc = {
    fullscreenElement: initiallyFullscreen ? ({} as Element) : null,
    exitFullscreen: vi.fn(async () => {
      doc.fullscreenElement = null;
    }),
    documentElement: {
      requestFullscreen: vi.fn(async () => {
        if (reject) throw new TypeError("denied");
        doc.fullscreenElement = {} as Element;
      }),
    },
  };
  return doc;
}

describe("toggleLocalFullscreen", () => {
  it("enters fullscreen when not fullscreen", async () => {
    const doc = fakeDoc(false);
    await expect(
      toggleLocalFullscreen(doc as unknown as Document)
    ).resolves.toBe(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalled();
  });

  it("exits fullscreen when fullscreen", async () => {
    const doc = fakeDoc(true);
    await expect(
      toggleLocalFullscreen(doc as unknown as Document)
    ).resolves.toBe(false);
    expect(doc.exitFullscreen).toHaveBeenCalled();
  });

  it("swallows a rejected request and reports the real state", async () => {
    const doc = fakeDoc(false, true);
    await expect(
      toggleLocalFullscreen(doc as unknown as Document)
    ).resolves.toBe(false);
  });
});

describe("isFullscreenKey", () => {
  it("matches f and F only", () => {
    expect(isFullscreenKey({ key: "f" })).toBe(true);
    expect(isFullscreenKey({ key: "F" })).toBe(true);
    expect(isFullscreenKey({ key: "Escape" })).toBe(false);
  });
});
