/**
 * Test helpers for reading Blobs under jsdom, whose Blob lacks
 * `arrayBuffer()` / `text()`.
 */
export function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await readBlobBytes(blob));
}
