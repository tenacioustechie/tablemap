/**
 * The ping layer (T011, ADR 0016): an animated pulse per active ping,
 * drawn above the fog (a ping is a "look here", it reveals nothing about
 * the map under it) in a non-listening layer. Sizes are in screen pixels
 * (divided by the stage scale) so a pulse looks the same at any zoom and on
 * the calibrated TV. Shared by both views.
 *
 * The animation: a dot that holds then fades, and two rings expanding out
 * of it, the second a quarter period behind the first, each fading as it
 * grows. Everything is a function of `pingProgress(ping, now)`.
 */
import { Circle, Layer } from "react-konva";
import { pingProgress, type Ping } from "../state/ping";

export const PING_COLOR = "#ffcc00";
/** Screen pixels. */
export const PING_DOT_RADIUS = 7;
export const PING_RING_MIN = 8;
export const PING_RING_MAX = 60;
export const PING_RING_WIDTH = 3;

export interface PingLayerProps {
  pings: readonly Ping[];
  now: number;
  /** Stage scale, to keep the pulse a fixed screen size. */
  scale: number;
}

function Ring({ ping, progress, scale }: { ping: Ping; progress: number; scale: number }) {
  if (progress <= 0 || progress >= 1) return null;
  const radius = (PING_RING_MIN + (PING_RING_MAX - PING_RING_MIN) * progress) / scale;
  return (
    <Circle
      x={ping.x}
      y={ping.y}
      radius={radius}
      stroke={PING_COLOR}
      strokeWidth={PING_RING_WIDTH}
      strokeScaleEnabled={false}
      opacity={1 - progress}
      listening={false}
    />
  );
}

export function PingNode({ ping, now, scale }: { ping: Ping; now: number; scale: number }) {
  const p = pingProgress(ping, now);
  // The dot stays solid for most of the pulse, then fades out.
  const dotOpacity = p < 0.7 ? 1 : Math.max(0, (1 - p) / 0.3);
  return (
    <>
      <Ring ping={ping} progress={p} scale={scale} />
      <Ring ping={ping} progress={p - 0.25} scale={scale} />
      <Circle
        name="ping"
        id={`ping-${ping.id}`}
        x={ping.x}
        y={ping.y}
        radius={PING_DOT_RADIUS / scale}
        fill={PING_COLOR}
        opacity={dotOpacity}
        listening={false}
      />
    </>
  );
}

export function PingLayer({ pings, now, scale }: PingLayerProps) {
  return (
    <Layer name="pings" listening={false}>
      {pings.map((ping) => (
        <PingNode key={ping.id} ping={ping} now={now} scale={scale} />
      ))}
    </Layer>
  );
}
