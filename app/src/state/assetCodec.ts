/**
 * Blob <-> base64 for carrying assets inside JSON sync messages (ADR 0008).
 * Works in browsers, jsdom and Node: only `Blob`, `FileReader`,
 * `btoa`/`atob` and typed arrays are used.
 */

const CHUNK = 0x8000;

/** The bytes of a Blob, in browsers, jsdom and Node alike. */
export function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  // jsdom's Blob has no arrayBuffer(); go through FileReader.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = await blobToBytes(blob);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Throws on malformed input (callers treat that as an invalid message). */
export function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
