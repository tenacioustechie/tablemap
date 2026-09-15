/**
 * The token layer of the stage (T010, ADR 0015), between the grid and the
 * fog. A token is a coloured disc or a round-clipped image, `size` cells a
 * side, with a short badge. Shared by both views:
 *
 * - the player view draws only tokens whose `visibility` is `visible` — not
 *   the DM-hidden ones, not those with a fogged cell (`state/tokens.ts`);
 * - the DM view draws every token. Fogged ones sit under the half-opaque
 *   fog layer, which dims them; hidden ones are drawn at reduced opacity
 *   with a dashed ring so the DM can tell them apart. With a `tool`, tokens
 *   are draggable (live snap / clamp through `placeToken`), a click selects,
 *   and the selected token gets a highlight box.
 *
 * Image tokens need their Blob (`images`, keyed by asset id: the database on
 * the DM side, the sync mirror's assets on the player side); until it has
 * arrived a grey disc with the badge stands in.
 */
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { Circle, Group, Image as KonvaImage, Layer, Rect, Text } from "react-konva";
import type { AssetId, GridGeometry, GridView, MapScene, Token } from "../state/model";
import {
  placeToken,
  tokenFootprintPx,
  type TokenPoint,
  type TokenVisibility,
} from "../state/tokens";
import { useImageElement } from "./useImageElement";

/** DM interaction with tokens; absent on the player and while a canvas tool runs. */
export interface TokenTool {
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The token's new top-left after a drag, already clamped and snapped. */
  onMove: (id: string, topLeft: TokenPoint) => void;
  /**
   * Where the token would land, clamped and snapped like the drop, on every
   * move of a drag (T106: the DM canvas previews what it would see there).
   */
  onDragMove?: (id: string, topLeft: TokenPoint) => void;
}

export interface TokenLayerProps {
  scene: Pick<MapScene, "tokens" | "grid" | "width" | "height">;
  view: GridView;
  visibility: Readonly<Record<string, TokenVisibility>>;
  images?: Readonly<Record<AssetId, Blob>>;
  tool?: TokenTool;
  /** Stage scale, to keep outlines a fixed screen size. */
  scale: number;
}

/** Opacity of a DM-hidden token on the DM view. */
export const HIDDEN_TOKEN_OPACITY = 0.45;

const FONT = "system-ui, sans-serif";

function badgeFontSize(side: number, badge: string): number {
  const factor = badge.length <= 1 ? 0.55 : badge.length === 2 ? 0.42 : 0.32;
  return side * factor;
}

function Disc({ side, color }: { side: number; color: string }) {
  const r = side / 2;
  return (
    <Circle
      x={r}
      y={r}
      radius={r * 0.92}
      fill={color}
      stroke="#111"
      strokeWidth={2}
      strokeScaleEnabled={false}
    />
  );
}

function CentredBadge({ side, badge }: { side: number; badge: string }) {
  return (
    <Text
      x={0}
      y={0}
      width={side}
      height={side}
      align="center"
      verticalAlign="middle"
      text={badge}
      fontSize={badgeFontSize(side, badge)}
      fontStyle="bold"
      fontFamily={FONT}
      fill="#fff"
      shadowColor="#000"
      shadowBlur={side * 0.08}
      listening={false}
    />
  );
}

/** A small badge pill in the bottom-right corner (image tokens). */
function CornerBadge({ side, badge }: { side: number; badge: string }) {
  const r = side * 0.18;
  const cx = side - r;
  const cy = side - r;
  return (
    <>
      <Circle x={cx} y={cy} radius={r} fill="#111" stroke="#fff" strokeWidth={1} strokeScaleEnabled={false} listening={false} />
      <Text
        x={cx - r}
        y={cy - r}
        width={r * 2}
        height={r * 2}
        align="center"
        verticalAlign="middle"
        text={badge}
        fontSize={badgeFontSize(r * 2, badge)}
        fontStyle="bold"
        fontFamily={FONT}
        fill="#fff"
        listening={false}
      />
    </>
  );
}

function ImageDisc({ side, blob }: { side: number; blob: Blob | undefined }) {
  const { image } = useImageElement(blob);
  const r = side / 2;
  if (!image) return <Disc side={side} color="#555" />;
  // Fit the image into the footprint (contain) and clip it to a circle.
  const iw = image.naturalWidth || image.width || 1;
  const ih = image.naturalHeight || image.height || 1;
  const k = Math.max(side / iw, side / ih); // cover: the disc is fully painted
  const w = iw * k;
  const h = ih * k;
  return (
    <>
      <Group
        clipFunc={(ctx) => {
          ctx.beginPath();
          ctx.arc(r, r, r * 0.96, 0, Math.PI * 2);
          ctx.closePath();
        }}
      >
        <KonvaImage image={image} x={(side - w) / 2} y={(side - h) / 2} width={w} height={h} />
      </Group>
      <Circle x={r} y={r} radius={r * 0.96} stroke="#111" strokeWidth={2} strokeScaleEnabled={false} listening={false} />
    </>
  );
}

interface TokenNodeProps {
  token: Token;
  grid: GridGeometry;
  map: { width: number; height: number };
  view: GridView;
  visibility: TokenVisibility;
  image: Blob | undefined;
  tool: TokenTool | undefined;
  scale: number;
}

function TokenNode({ token, grid, map, view, visibility, image, tool, scale }: TokenNodeProps) {
  const side = tokenFootprintPx(token.size, grid.cellSize);
  const r = side / 2;
  const hiddenOnDm = view === "dm" && token.hidden;
  const selected = tool?.selectedId === token.id;
  const draggable = tool !== undefined;

  const setCursor = (e: KonvaEventObject<MouseEvent>, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };
  const settle = (node: Konva.Node): TokenPoint => {
    const placed = placeToken(node.position(), token, grid, map);
    node.position(placed);
    return placed;
  };

  return (
    <Group
      name="token"
      id={`token-${token.id}`}
      x={token.x}
      y={token.y}
      opacity={hiddenOnDm ? HIDDEN_TOKEN_OPACITY : 1}
      draggable={draggable}
      onClick={() => tool?.onSelect(token.id)}
      onTap={() => tool?.onSelect(token.id)}
      onDragStart={() => tool?.onSelect(token.id)}
      onDragMove={(e) => tool?.onDragMove?.(token.id, settle(e.target))}
      onDragEnd={(e) => tool?.onMove(token.id, settle(e.target))}
      onMouseEnter={(e) => draggable && setCursor(e, "grab")}
      onMouseLeave={(e) => draggable && setCursor(e, "")}
    >
      {token.appearance.type === "disc" ? (
        <>
          <Disc side={side} color={token.appearance.color} />
          {token.badge !== "" && <CentredBadge side={side} badge={token.badge} />}
        </>
      ) : (
        <>
          <ImageDisc side={side} blob={image} />
          {token.badge !== "" && <CornerBadge side={side} badge={token.badge} />}
        </>
      )}
      {hiddenOnDm && (
        <Circle
          x={r}
          y={r}
          radius={r * 0.92}
          stroke="#fff"
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          dash={[6 / scale, 4 / scale]}
          listening={false}
        />
      )}
      {view === "dm" && visibility === "fogged" && (
        // A hint for the DM that the players cannot see this one (the fog
        // layer above already dims it).
        <Rect
          x={0}
          y={0}
          width={side}
          height={side}
          stroke="#000"
          strokeWidth={1}
          strokeScaleEnabled={false}
          dash={[3 / scale, 3 / scale]}
          listening={false}
        />
      )}
      {selected && (
        <Rect
          x={0}
          y={0}
          width={side}
          height={side}
          stroke="#8cf"
          strokeWidth={2}
          strokeScaleEnabled={false}
          listening={false}
        />
      )}
    </Group>
  );
}

export function TokenLayer({ scene, view, visibility, images, tool, scale }: TokenLayerProps) {
  const shown =
    view === "player"
      ? scene.tokens.filter((t) => visibility[t.id] === "visible")
      : scene.tokens;
  return (
    <Layer name="tokens" listening={tool !== undefined}>
      {shown.map((token) => (
        <TokenNode
          key={token.id}
          token={token}
          grid={scene.grid}
          map={scene}
          view={view}
          visibility={visibility[token.id] ?? "visible"}
          image={
            token.appearance.type === "image" ? images?.[token.appearance.assetId] : undefined
          }
          tool={tool}
          scale={scale}
        />
      ))}
    </Layer>
  );
}

/** How many of a scene's tokens the given view draws. */
export function shownTokenCount(
  tokens: readonly Token[],
  view: GridView,
  visibility: Readonly<Record<string, TokenVisibility>>
): number {
  return view === "player"
    ? tokens.filter((t) => visibility[t.id] === "visible").length
    : tokens.length;
}
