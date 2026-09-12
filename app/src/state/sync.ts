/**
 * DM <-> player sync protocol (ADR 0003, ADR 0006).
 *
 * All traffic between the DM window and player windows is one of the message
 * types below, serialised with `encodeMessage` and validated on receipt with
 * `decodeMessage`. Every message carries `PROTOCOL_VERSION`; messages from a
 * different version are rejected so a stale player window can never apply
 * state it does not understand.
 *
 * Flow:
 *   player --hello--> DM            (on load, and whenever it detects a gap)
 *   DM   --snapshot--> player       (full state + current seq)
 *   DM   --delta-->    player       (ops applied since seq-1)
 *
 * The player is a mirror: it only ever sends `hello`. It never sends ops.
 */
import { isSharedOp, isSharedState, type SharedOp, type SharedState } from "./shared";

export const PROTOCOL_VERSION = 1;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** BroadcastChannel name shared by every TableMap window on the origin. */
export const SYNC_CHANNEL_NAME = "tablemap-sync";

export type SyncRole = "dm" | "player";

/** Announces a window. A player hello is a request for a snapshot. */
export interface HelloMessage {
  type: "hello";
  v: ProtocolVersion;
  role: SyncRole;
  clientId: string;
}

/** Full shared state. `seq` is the DM's op counter at the time of capture. */
export interface SnapshotMessage {
  type: "snapshot";
  v: ProtocolVersion;
  seq: number;
  state: SharedState;
}

/** Ops applied by the DM in one dispatch, moving its counter to `seq`. */
export interface DeltaMessage {
  type: "delta";
  v: ProtocolVersion;
  seq: number;
  ops: SharedOp[];
}

export type SyncMessage = HelloMessage | SnapshotMessage | DeltaMessage;
export type SyncMessageType = SyncMessage["type"];

export const SYNC_MESSAGE_TYPES: readonly SyncMessageType[] = [
  "hello",
  "snapshot",
  "delta",
];

// ---- constructors ---------------------------------------------------------

export function hello(role: SyncRole, clientId: string): HelloMessage {
  return { type: "hello", v: PROTOCOL_VERSION, role, clientId };
}

export function snapshot(seq: number, state: SharedState): SnapshotMessage {
  return { type: "snapshot", v: PROTOCOL_VERSION, seq, state };
}

export function delta(seq: number, ops: readonly SharedOp[]): DeltaMessage {
  return { type: "delta", v: PROTOCOL_VERSION, seq, ops: [...ops] };
}

// ---- encode / decode ------------------------------------------------------

export function encodeMessage(message: SyncMessage): string {
  return JSON.stringify(message);
}

export type DecodeFailure =
  | "malformed"
  | "version-mismatch"
  | "unknown-type"
  | "invalid-shape";

export type DecodeResult =
  | { ok: true; message: SyncMessage }
  | { ok: false; reason: DecodeFailure };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isSeq(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/** Validates an already-parsed value. Exposed for transports that carry objects. */
export function validateMessage(value: unknown): DecodeResult {
  if (!isRecord(value)) return { ok: false, reason: "malformed" };
  if (value.v !== PROTOCOL_VERSION) {
    return { ok: false, reason: "version-mismatch" };
  }
  switch (value.type) {
    case "hello": {
      const roleOk = value.role === "dm" || value.role === "player";
      if (!roleOk || typeof value.clientId !== "string") {
        return { ok: false, reason: "invalid-shape" };
      }
      return {
        ok: true,
        message: hello(value.role as SyncRole, value.clientId),
      };
    }
    case "snapshot": {
      if (!isSeq(value.seq) || !isSharedState(value.state)) {
        return { ok: false, reason: "invalid-shape" };
      }
      return { ok: true, message: snapshot(value.seq, value.state) };
    }
    case "delta": {
      if (
        !isSeq(value.seq) ||
        !Array.isArray(value.ops) ||
        !value.ops.every(isSharedOp)
      ) {
        return { ok: false, reason: "invalid-shape" };
      }
      return { ok: true, message: delta(value.seq, value.ops) };
    }
    default:
      return { ok: false, reason: "unknown-type" };
  }
}

/** Parses a wire string. Never throws. */
export function decodeMessage(raw: unknown): DecodeResult {
  if (typeof raw !== "string") return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return validateMessage(parsed);
}
