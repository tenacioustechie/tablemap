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
 *   DM   --asset-->    player       (one binary asset the state references)
 *
 * The player is a mirror: it only ever sends `hello`. It never sends ops.
 *
 * Assets (map images, later fog masks and token art) are Blobs in the DM's
 * IndexedDB; the player never reads storage, so the DM pushes them as
 * base64 `asset` messages (ADR 0008). They are not sequenced: the player
 * keeps them in a side table keyed by id and renders whatever has arrived.
 */
import {
  clonePlayerPresentation,
  isDisplayInfo,
  isPlayerPresentation,
  type DisplayInfo,
  type PlayerPresentation,
} from "./calibration";
import { isAssetKind, isNonEmptyString, type AssetId, type AssetKind } from "./model";
import { isSharedOp, isSharedState, type SharedOp, type SharedState } from "./shared";

export const PROTOCOL_VERSION = 1;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

/** BroadcastChannel name shared by every TableMap window on the origin. */
export const SYNC_CHANNEL_NAME = "tablemap-sync";

export type SyncRole = "dm" | "player";

/**
 * Announces a window. A player hello is a request for a snapshot; it may
 * carry the display the player window is on (T006) so the DM can look up
 * that display's calibration.
 */
export interface HelloMessage {
  type: "hello";
  v: ProtocolVersion;
  role: SyncRole;
  clientId: string;
  display?: DisplayInfo;
}

/**
 * How the player should present scenes on its display (ADR 0011):
 * calibration, overview override, ruler screen. Unsequenced like assets: the
 * latest one wins. Sent after every snapshot and whenever it changes.
 */
export interface PresentationMessage {
  type: "presentation";
  v: ProtocolVersion;
  presentation: PlayerPresentation;
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

/** One binary asset, base64-encoded. Unsequenced; idempotent per `id`. */
export interface AssetMessage {
  type: "asset";
  v: ProtocolVersion;
  id: AssetId;
  kind: AssetKind;
  /** MIME type of the Blob, e.g. "image/png". */
  mime: string;
  /** Base64 of the Blob's bytes. */
  data: string;
}

export type SyncMessage =
  | HelloMessage
  | SnapshotMessage
  | DeltaMessage
  | AssetMessage
  | PresentationMessage;
export type SyncMessageType = SyncMessage["type"];

export const SYNC_MESSAGE_TYPES: readonly SyncMessageType[] = [
  "hello",
  "snapshot",
  "delta",
  "asset",
  "presentation",
];

// ---- constructors ---------------------------------------------------------

export function hello(
  role: SyncRole,
  clientId: string,
  display?: DisplayInfo
): HelloMessage {
  const message: HelloMessage = { type: "hello", v: PROTOCOL_VERSION, role, clientId };
  if (display) message.display = { ...display };
  return message;
}

export function presentation(value: PlayerPresentation): PresentationMessage {
  return {
    type: "presentation",
    v: PROTOCOL_VERSION,
    presentation: clonePlayerPresentation(value),
  };
}

export function snapshot(seq: number, state: SharedState): SnapshotMessage {
  return { type: "snapshot", v: PROTOCOL_VERSION, seq, state };
}

export function delta(seq: number, ops: readonly SharedOp[]): DeltaMessage {
  return { type: "delta", v: PROTOCOL_VERSION, seq, ops: [...ops] };
}

export function asset(
  id: AssetId,
  kind: AssetKind,
  mime: string,
  data: string
): AssetMessage {
  return { type: "asset", v: PROTOCOL_VERSION, id, kind, mime, data };
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
      if (value.display !== undefined && !isDisplayInfo(value.display)) {
        return { ok: false, reason: "invalid-shape" };
      }
      return {
        ok: true,
        message: hello(value.role as SyncRole, value.clientId, value.display),
      };
    }
    case "presentation": {
      if (!isPlayerPresentation(value.presentation)) {
        return { ok: false, reason: "invalid-shape" };
      }
      const p = value.presentation;
      return {
        ok: true,
        message: presentation({
          pxPerInch: p.pxPerInch,
          cellUnit: p.cellUnit,
          overview: p.overview,
          target: p.target,
          rotation: p.rotation,
          center: p.center === null ? null : { x: p.center.x, y: p.center.y },
          blackout: p.blackout,
          splash: p.splash,
        }),
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
    case "asset": {
      if (
        !isNonEmptyString(value.id) ||
        !isAssetKind(value.kind) ||
        typeof value.mime !== "string" ||
        typeof value.data !== "string"
      ) {
        return { ok: false, reason: "invalid-shape" };
      }
      return {
        ok: true,
        message: asset(value.id, value.kind, value.mime, value.data),
      };
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
