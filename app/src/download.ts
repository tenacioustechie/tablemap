/**
 * Offers a Blob to the user as a file download: a temporary object URL on an
 * invisible link that is clicked and removed. Browser-only; components take
 * it as an injectable so tests can capture the file instead.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke once the browser has picked the download up; immediate revocation
  // can cancel it in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
