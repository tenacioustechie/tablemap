import { renderHook, waitFor } from "@testing-library/react";
import { nanoid } from "nanoid";
import { TableMapDb } from "../state/db";
import { useAssetBlobs } from "./useAssetBlob";

// jsdom's Blob is not structured-cloneable by fake-indexeddb, and the hook
// never looks inside the Blob, so a string stands in for it here.
const fakeBlob = (text: string) => text as unknown as Blob;

describe("useAssetBlobs (T010)", () => {
  let db: TableMapDb;
  beforeEach(async () => {
    db = new TableMapDb(`tablemap-test-${nanoid()}`);
    await db.assets.put({ id: "a", campaignId: "c", kind: "token-image", blob: fakeBlob("A") });
    await db.assets.put({ id: "b", campaignId: "c", kind: "token-image", blob: fakeBlob("B") });
  });
  afterEach(async () => {
    await db.delete();
  });

  it("loads the asked-for assets, skips missing ones and drops those no longer asked for", async () => {
    const { result, rerender } = renderHook(({ ids }) => useAssetBlobs(db, ids), {
      initialProps: { ids: ["a", "missing"] },
    });
    expect(result.current).toEqual({});
    await waitFor(() => expect(result.current).toEqual({ a: "A" }));

    rerender({ ids: ["a", "b"] });
    await waitFor(() => expect(result.current).toEqual({ a: "A", b: "B" }));

    rerender({ ids: ["b"] });
    await waitFor(() => expect(result.current).toEqual({ b: "B" }));

    rerender({ ids: [] });
    await waitFor(() => expect(result.current).toEqual({}));
  });

  it("keeps the same object while nothing changes", async () => {
    const { result, rerender } = renderHook(({ ids }) => useAssetBlobs(db, ids), {
      initialProps: { ids: ["a"] },
    });
    await waitFor(() => expect(result.current).toEqual({ a: "A" }));
    const first = result.current;
    rerender({ ids: ["a"] });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(first);
  });
});
