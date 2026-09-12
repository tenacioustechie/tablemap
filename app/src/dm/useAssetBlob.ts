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

/**
 * Blobs for several asset ids at once (T010: the active map's token images),
 * keyed by id. Entries appear as they load; ids no longer asked for are
 * dropped. Missing or unreadable assets simply never appear.
 */
export function useAssetBlobs(
  db: TableMapDb,
  ids: readonly AssetId[]
): Readonly<Record<AssetId, Blob>> {
  const [blobs, setBlobs] = useState<Record<AssetId, Blob>>({});
  const key = ids.join("\n");

  useEffect(() => {
    const wanted = key === "" ? [] : key.split("\n");
    let cancelled = false;
    setBlobs((prev) => {
      const kept = Object.keys(prev).filter((id) => wanted.includes(id));
      if (kept.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(kept.map((id) => [id, prev[id]]));
    });
    for (const id of wanted) {
      getAsset(db, id)
        .then((record) => {
          if (cancelled || !record) return;
          setBlobs((prev) => (prev[id] === record.blob ? prev : { ...prev, [id]: record.blob }));
        })
        .catch(() => {
          /* missing or unreadable asset: the token renders without an image */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [db, key]);

  return blobs;
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
