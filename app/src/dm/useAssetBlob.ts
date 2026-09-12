/**
 * DM-side asset access: reads a Blob from the campaign database for an
 * asset id, and turns Blobs into object URLs for `<img>` thumbnails.
 */
import { useEffect, useState } from "react";
import type { TableMapDb } from "../state/db";
import type { AssetId } from "../state/model";
import { getAsset } from "../state/persistence";

export function useAssetBlob(
  db: TableMapDb,
  id: AssetId | null | undefined
): Blob | undefined {
  const [entry, setEntry] = useState<{ id: AssetId; blob: Blob } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getAsset(db, id)
      .then((record) => {
        if (!cancelled && record) setEntry({ id, blob: record.blob });
      })
      .catch(() => {
        /* missing or unreadable asset: render without an image */
      });
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  return id && entry?.id === id ? entry.blob : undefined;
}

/** An object URL for `blob`, revoked when it changes. Null where unsupported (jsdom). */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== "function") {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}
