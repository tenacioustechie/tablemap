/**
 * The ping clock (T011): given the recent pings a window holds, returns the
 * ones still active on the given map and a `now` that advances every
 * animation frame while any is playing, then stops. Rendering derives the
 * pulse from `pingProgress(ping, now)`, so nothing needs a timer per ping
 * and an idle stage costs no frames.
 *
 * Whether the clock runs is decided from the *same* `now` the render uses,
 * never from a fresh `Date.now()`: a render that happened to fall a few
 * milliseconds after the last pulse's end, while the state still held an
 * earlier time, would otherwise stop the clock with the pulse still drawn.
 */
import { useEffect, useState } from "react";
import { activePings, PING_DURATION_MS, type Ping } from "../state/ping";

export interface PingClock {
  active: Ping[];
  now: number;
}

const requestFrame: (cb: () => void) => () => void =
  typeof requestAnimationFrame === "function"
    ? (cb) => {
        const id = requestAnimationFrame(() => cb());
        return () => cancelAnimationFrame(id);
      }
    : (cb) => {
        const id = setTimeout(cb, 16);
        return () => clearTimeout(id);
      };

/** When the last of these pings ends, whether or not it has started yet. */
function lastPingEnd(pings: readonly Ping[]): number {
  let end = 0;
  for (const p of pings) end = Math.max(end, p.at + PING_DURATION_MS);
  return end;
}

export function usePings(pings: readonly Ping[], mapId: string | undefined): PingClock {
  const [now, setNow] = useState(() => Date.now());
  // The clock runs until the state's `now` has passed the last pulse's end;
  // a new ping (later than `now`) starts it again.
  const expireAt = lastPingEnd(pings);
  const running = expireAt > now;

  useEffect(() => {
    if (!running) return;
    let cancel: (() => void) | null = null;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const t = Date.now();
      setNow(t);
      if (t < expireAt) cancel = requestFrame(tick);
    };
    setNow(Date.now());
    cancel = requestFrame(tick);
    // Animation frames stop in a hidden window (a minimised player window,
    // a background tab); a timer still fires there, so the pulse always
    // ends on time and does not stick until the window is shown again.
    const timer = setTimeout(() => {
      if (!stopped) setNow(Date.now());
    }, Math.max(0, expireAt - Date.now()) + 20);
    return () => {
      stopped = true;
      cancel?.();
      clearTimeout(timer);
    };
  }, [running, expireAt]);

  const active = mapId === undefined ? [] : activePings(pings, now, mapId);
  return { active, now };
}
