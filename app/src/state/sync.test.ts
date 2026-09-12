import { defaultPlayerPresentation, type DisplayInfo } from "./calibration";
import { initialSharedState, type SharedOp } from "./shared";
import {
  asset,
  decodeMessage,
  delta,
  encodeMessage,
  hello,
  presentation,
  PROTOCOL_VERSION,
  snapshot,
  SYNC_MESSAGE_TYPES,
  validateMessage,
  type SyncMessage,
} from "./sync";

const tv: DisplayInfo = { width: 1920, height: 1080, pixelRatio: 1, left: 1920, top: 0 };

const ops: SharedOp[] = [
  { kind: "campaign/set-name", name: "Curse of Strahd" },
  { kind: "campaign/set-name", name: "" },
  {
    kind: "campaign/replace",
    state: { ...initialSharedState(), campaignName: "Replaced" },
  },
];

/** One example of every message type; the test below checks coverage. */
const examples: Record<SyncMessage["type"], SyncMessage> = {
  hello: hello("player", "abc123"),
  snapshot: snapshot(7, { ...initialSharedState(), campaignName: "Strahd" }),
  delta: delta(8, ops),
  asset: asset("img-1", "map-image", "image/png", "iVBORw0KGgo="),
  presentation: presentation({
    pxPerInch: 40.5,
    cellUnit: "mm25",
    overview: true,
    target: null,
    rotation: 270,
    center: { x: 12.5, y: -3 },
    blackout: true,
    splash: false,
  }),
};

describe("sync protocol", () => {
  it("has an example for every message type", () => {
    expect(Object.keys(examples).sort()).toEqual([...SYNC_MESSAGE_TYPES].sort());
  });

  it.each(Object.entries(examples))(
    "%s round-trips through encode/decode",
    (_type, message) => {
      const raw = encodeMessage(message);
      expect(typeof raw).toBe("string");
      const result = decodeMessage(raw);
      expect(result).toEqual({ ok: true, message });
    }
  );

  it.each(Object.entries(examples))(
    "%s carries the protocol version",
    (_type, message) => {
      expect(message.v).toBe(PROTOCOL_VERSION);
      expect(JSON.parse(encodeMessage(message)).v).toBe(PROTOCOL_VERSION);
    }
  );

  it("decoded messages are fresh objects, not aliases of the input", () => {
    const message = delta(1, ops);
    const result = decodeMessage(encodeMessage(message));
    expect(result.ok && result.message).not.toBe(message);
  });

  it("rejects messages from another protocol version", () => {
    const stale = { ...hello("dm", "x"), v: PROTOCOL_VERSION + 1 };
    expect(decodeMessage(JSON.stringify(stale))).toEqual({
      ok: false,
      reason: "version-mismatch",
    });
    const missing = { type: "hello", role: "dm", clientId: "x" };
    expect(validateMessage(missing)).toEqual({
      ok: false,
      reason: "version-mismatch",
    });
  });

  it("rejects malformed input without throwing", () => {
    for (const raw of ["", "{", "null", "[]", "42", '"str"']) {
      expect(decodeMessage(raw)).toEqual({ ok: false, reason: "malformed" });
    }
    expect(decodeMessage(undefined)).toEqual({ ok: false, reason: "malformed" });
    expect(decodeMessage({ type: "hello" })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects unknown message types", () => {
    expect(validateMessage({ type: "mutate", v: PROTOCOL_VERSION })).toEqual({
      ok: false,
      reason: "unknown-type",
    });
  });

  it("rejects well-typed messages with the wrong shape", () => {
    const bad: unknown[] = [
      { type: "hello", v: PROTOCOL_VERSION, role: "admin", clientId: "x" },
      { type: "hello", v: PROTOCOL_VERSION, role: "dm" },
      { type: "snapshot", v: PROTOCOL_VERSION, seq: -1, state: {} },
      { type: "snapshot", v: PROTOCOL_VERSION, seq: 1, state: { nope: 1 } },
      { type: "snapshot", v: PROTOCOL_VERSION, seq: 1.5, state: initialSharedState() },
      { type: "delta", v: PROTOCOL_VERSION, seq: 1, ops: [{ kind: "nope" }] },
      { type: "delta", v: PROTOCOL_VERSION, seq: 1, ops: "not-a-list" },
      { type: "delta", v: PROTOCOL_VERSION, seq: 1, ops: [{ kind: "campaign/set-name" }] },
      { type: "delta", v: PROTOCOL_VERSION, seq: 1, ops: [{ kind: "campaign/replace", state: { campaignName: "x" } }] },
      { type: "snapshot", v: PROTOCOL_VERSION, seq: 1, state: { campaignName: "x", maps: [{ id: "m" }], activeMapId: null } },
      { type: "asset", v: PROTOCOL_VERSION, id: "", kind: "map-image", mime: "image/png", data: "" },
      { type: "asset", v: PROTOCOL_VERSION, id: "a", kind: "video", mime: "image/png", data: "" },
      { type: "asset", v: PROTOCOL_VERSION, id: "a", kind: "map-image", mime: 7, data: "" },
      { type: "asset", v: PROTOCOL_VERSION, id: "a", kind: "map-image", mime: "image/png" },
      { type: "hello", v: PROTOCOL_VERSION, role: "player", clientId: "p", display: { width: 0 } },
      { type: "hello", v: PROTOCOL_VERSION, role: "player", clientId: "p", display: null },
      { type: "presentation", v: PROTOCOL_VERSION },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), pxPerInch: 1 } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), cellUnit: "cm" } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), target: 0 } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), rotation: 45 } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), center: { x: 1 } } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), center: { x: NaN, y: 0 } } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), blackout: 1 } },
      { type: "presentation", v: PROTOCOL_VERSION, presentation: { ...defaultPlayerPresentation(), splash: "on" } },
      { type: "delta", v: PROTOCOL_VERSION, seq: 1, ops: [{ kind: "campaign/set-splash-image", assetId: "" }] },
    ];
    for (const value of bad) {
      expect(validateMessage(value)).toEqual({
        ok: false,
        reason: "invalid-shape",
      });
    }
  });

  it("drops unknown extra fields when validating", () => {
    const extra = { ...hello("dm", "x"), secret: "leak" };
    const result = validateMessage(extra);
    expect(result).toEqual({ ok: true, message: hello("dm", "x") });
  });

  it("a player hello may carry its display; without one the field is absent", () => {
    const withDisplay = hello("player", "p", tv);
    expect(withDisplay.display).toEqual(tv);
    expect(withDisplay.display).not.toBe(tv);
    expect(decodeMessage(encodeMessage(withDisplay))).toEqual({ ok: true, message: withDisplay });
    expect("display" in hello("player", "p")).toBe(false);
    expect(JSON.parse(encodeMessage(hello("player", "p")))).not.toHaveProperty("display");
  });

  it("presentation messages round-trip every mode", () => {
    for (const value of [
      defaultPlayerPresentation(),
      { ...defaultPlayerPresentation(), pxPerInch: 96, target: 96 },
      { ...defaultPlayerPresentation(), cellUnit: "mm25" as const, overview: true },
      { ...defaultPlayerPresentation(), rotation: 90 as const, center: { x: 0, y: 0 }, splash: true },
      { ...defaultPlayerPresentation(), blackout: true, center: { x: -1.5, y: 2e6 } },
    ]) {
      const message = presentation(value);
      expect(message.presentation).not.toBe(value);
      if (value.center !== null) expect(message.presentation.center).not.toBe(value.center);
      expect(decodeMessage(encodeMessage(message))).toEqual({ ok: true, message });
    }
    // Unknown keys inside the presentation are dropped too.
    const decoded = validateMessage({
      type: "presentation",
      v: PROTOCOL_VERSION,
      presentation: { ...defaultPlayerPresentation(), center: { x: 1, y: 2, z: 3 }, extra: true },
    });
    expect(decoded).toEqual({
      ok: true,
      message: presentation({ ...defaultPlayerPresentation(), center: { x: 1, y: 2 } }),
    });
  });
});
