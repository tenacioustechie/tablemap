import { initialSharedState, type SharedOp } from "./shared";
import {
  decodeMessage,
  delta,
  encodeMessage,
  hello,
  PROTOCOL_VERSION,
  snapshot,
  SYNC_MESSAGE_TYPES,
  validateMessage,
  type SyncMessage,
} from "./sync";

const ops: SharedOp[] = [
  { kind: "campaign/set-name", name: "Curse of Strahd" },
  { kind: "campaign/set-name", name: "" },
];

/** One example of every message type; the test below checks coverage. */
const examples: Record<SyncMessage["type"], SyncMessage> = {
  hello: hello("player", "abc123"),
  snapshot: snapshot(7, { ...initialSharedState(), campaignName: "Strahd" }),
  delta: delta(8, ops),
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
});
