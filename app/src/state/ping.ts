/**
 * Pings (T011, ADR 0016): the DM alt-clicks a map point and every view
 * shows an animated pulse there for `PING_DURATION_MS`, then nothing.
 *
 * A ping is an *event*, not state: it is not part of `SharedState`, never
 * persisted, and travels as its own unsequenced `ping` sync message (a late
 * player has no use for old pings, so they are not in snapshots either).
 * Both windows keep a short list of recent pings — the DM store for its own
 * canvas, the player's mirror — bounded without a clock: `addPing` drops
 * everything that had already expired when the new one was sent, and keeps
 * at most `PING_MAX`. Views ask `activePings(pings, now)` what to draw.
 *
 * Timestamps are `Date.now()` on the DM; the player window is on the same
 * machine (ADR 0003), so it can compare them with its own clock.
 */
import { nanoid } from "nanoid";

export interface Ping {
  id: string;
  /** The map the pulse belongs to; views ignore pings for other maps. */
  mapId: string;
  /** Map pixels. */
  x: number;
  y: number;
  /** Epoch milliseconds when the DM sent it. */
  at: number;
}

/** How long a pulse plays. */
export const PING_DURATION_MS = 2000;

/** Most pings kept at once; older ones are dropped first. */
export const PING_MAX = 16;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isFinite(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function isPing(x: unknown): x is Ping {
  return (
    isRecord(x) &&
    typeof x.id === "string" &&
    x.id.length > 0 &&
    typeof x.mapId === "string" &&
    x.mapId.length > 0 &&
    isFinite(x.x) &&
    isFinite(x.y) &&
    isFinite(x.at)
  );
}

export function clonePing(ping: Ping): Ping {
  return { id: ping.id, mapId: ping.mapId, x: ping.x, y: ping.y, at: ping.at };
}

export interface NewPing {
  mapId: string;
  x: number;
  y: number;
  id?: string;
  now?: number;
}

export function createPing({ mapId, x, y, id = nanoid(), now = Date.now() }: NewPing): Ping {
  return { id, mapId, x, y, at: now };
}

/** True while the pulse should still be drawn at time `now`. */
export function isPingActive(ping: Ping, now: number): boolean {
  const age = now - ping.at;
  return age >= 0 && age < PING_DURATION_MS;
}

/** 0 at the start of the pulse, 1 at its end; clamped. */
export function pingProgress(ping: Ping, now: number): number {
  const p = (now - ping.at) / PING_DURATION_MS;
  return Math.max(0, Math.min(1, p));
}

/**
 * The list with `ping` appended. Pings that had already expired when the
 * new one was sent are dropped (that timestamp is the newest "now" the
 * reducer knows), a duplicate id is ignored, and the list is capped at
 * `PING_MAX` (oldest out). Same object when nothing changes.
 */
export function addPing(pings: readonly Ping[], ping: Ping): readonly Ping[] {
  if (pings.some((p) => p.id === ping.id)) return pings;
  const kept = pings.filter((p) => isPingActive(p, ping.at));
  const next = [...kept, clonePing(ping)];
  return next.length > PING_MAX ? next.slice(next.length - PING_MAX) : next;
}

/** What to draw right now, on the given map. */
export function activePings(
  pings: readonly Ping[],
  now: number,
  mapId?: string
): Ping[] {
  return pings.filter((p) => isPingActive(p, now) && (mapId === undefined || p.mapId === mapId));
}

/** When the last of these pings expires; `now` when none is active. */
export function pingsExpireAt(pings: readonly Ping[], now: number): number {
  let latest = now;
  for (const p of pings) {
    if (isPingActive(p, now)) latest = Math.max(latest, p.at + PING_DURATION_MS);
  }
  return latest;
}
