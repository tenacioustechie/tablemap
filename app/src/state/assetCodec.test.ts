import { readBlobBytes, readBlobText } from "../test/blob";
import { base64ToBlob, blobToBase64 } from "./assetCodec";

describe("asset codec", () => {
  it("round-trips bytes and MIME type", async () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 7) % 256);
    const blob = new Blob([bytes], { type: "image/webp" });
    const data = await blobToBase64(blob);
    expect(data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
    const back = base64ToBlob(data, blob.type);
    expect(back.type).toBe("image/webp");
    expect(await readBlobBytes(back)).toEqual(bytes);
  });

  it("encodes an empty blob to an empty string", async () => {
    expect(await blobToBase64(new Blob([]))).toBe("");
    expect(base64ToBlob("", "image/png").size).toBe(0);
  });

  it("matches the standard base64 alphabet", async () => {
    expect(await blobToBase64(new Blob(["hello"]))).toBe("aGVsbG8=");
    expect(await readBlobText(base64ToBlob("aGVsbG8=", "text/plain"))).toBe("hello");
  });

  it("throws on malformed input", () => {
    expect(() => base64ToBlob("*not base64*", "image/png")).toThrow();
  });
});
