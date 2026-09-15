/**
 * The token layer's turn ring (T111, ADR 0027), in a bare stage: which token
 * each view rings — the DM any token on the scene, hidden or fogged; the
 * player only one it draws, so never a hidden or fogged one — and where and
 * how it is drawn. `turnRingToken` is the rule on its own.
 */
import { render } from "@testing-library/react";
import Konva from "konva";
import { Stage } from "react-konva";
import { createBlankMapScene } from "../state/maps";
import type { GridView, MapScene } from "../state/model";
import { createToken, type TokenVisibility } from "../state/tokens";
import {
  TokenLayer,
  TURN_RING_COLOR,
  TURN_RING_GAP_PX,
  TURN_RING_WIDTH_PX,
  turnRingToken,
  type TokenLayerProps,
} from "./TokenLayer";

const disc = { type: "disc" as const, color: "#f00" };
// 4 x 3 cells of 50 px: an orc, a hidden ghost and a 2 x 2 ogre.
const orc = createToken({ id: "orc", x: 50, y: 50, appearance: disc, badge: "O" });
const ghost = createToken({ id: "ghost", x: 100, y: 0, appearance: disc, hidden: true });
const ogre = createToken({ id: "ogre", x: 100, y: 50, size: 2, appearance: disc });
const scene: MapScene = {
  ...createBlankMapScene({ id: "s", columns: 4, rows: 3, cellSize: 50 }),
  tokens: [orc, ghost, ogre],
};
/** As the stage would judge them: the ghost hidden, the ogre on a fogged cell. */
const visibility: Record<string, TokenVisibility> = { orc: "visible", ghost: "hidden", ogre: "fogged" };

function renderLayer(props: Partial<TokenLayerProps> & { view: GridView }) {
  const base: TokenLayerProps = { scene, visibility, scale: 2, ...props };
  const stageOf = (next: Partial<TokenLayerProps>) => (
    <Stage width={200} height={150}>
      <TokenLayer {...base} {...next} />
    </Stage>
  );
  const utils = render(stageOf({}));
  const stage = () => Konva.stages.find((s) => utils.container.contains(s.container()))!;
  return {
    layer: () => stage().findOne<Konva.Layer>(".tokens")!,
    ring: () => stage().findOne<Konva.Circle>("#turn-ring"),
    rerender: (next: Partial<TokenLayerProps>) => utils.rerender(stageOf(next)),
  };
}

describe("turnRingToken (T111)", () => {
  it("names the turn token only when this view draws it", () => {
    const { tokens } = scene;
    expect(turnRingToken(tokens, "dm", visibility, null)).toBeUndefined();
    expect(turnRingToken(tokens, "dm", visibility, undefined)).toBeUndefined();
    expect(turnRingToken(tokens, "dm", visibility, "on-another-map")).toBeUndefined();
    expect(turnRingToken(tokens, "dm", visibility, "orc")).toBe(orc);
    expect(turnRingToken(tokens, "dm", visibility, "ghost")).toBe(ghost);
    expect(turnRingToken(tokens, "dm", visibility, "ogre")).toBe(ogre);
    expect(turnRingToken(tokens, "dm", {}, "orc")).toBe(orc);

    expect(turnRingToken(tokens, "player", visibility, "orc")).toBe(orc);
    expect(turnRingToken(tokens, "player", visibility, "ghost")).toBeUndefined();
    expect(turnRingToken(tokens, "player", visibility, "ogre")).toBeUndefined();
    expect(turnRingToken(tokens, "player", visibility, "on-another-map")).toBeUndefined();
    // Not judged visible is not drawn on the player, so not ringed either.
    expect(turnRingToken(tokens, "player", {}, "orc")).toBeUndefined();
  });
});

describe("TokenLayer turn ring (T111)", () => {
  it("draws nothing without a turn token, or for one that is not on this scene, in either view", () => {
    for (const view of ["dm", "player"] as const) {
      const { ring, rerender, layer } = renderLayer({ view });
      expect(ring()).toBeFalsy();
      rerender({ turnTokenId: "on-another-map" });
      expect(ring()).toBeFalsy();
      rerender({ turnTokenId: null });
      expect(ring()).toBeFalsy();
      expect(layer().find(".token").length).toBe(view === "dm" ? 3 : 1);
    }
  });

  it("on the DM rings any token of the scene — visible, hidden or fogged — gold, round its centre, above every token, deaf to the pointer", () => {
    const { ring, rerender, layer } = renderLayer({ view: "dm", turnTokenId: "orc" });
    const r = ring()!;
    expect(r.getAttr("data-testid")).toBe("turn-ring");
    expect(r.getAttr("data-token-id")).toBe("orc");
    expect(r.getLayer()).toBe(layer());
    // A child of the layer, not of the token's group: a hidden token's opacity does not fade it.
    expect(r.getParent()).toBe(layer());
    const children = layer().getChildren();
    expect(children[children.length - 1]).toBe(r);
    expect([r.x(), r.y()]).toEqual([75, 75]);
    expect(r.radius()).toBe(25 + TURN_RING_GAP_PX / 2);
    expect(r.stroke()).toBe(TURN_RING_COLOR);
    expect(r.strokeWidth()).toBe(TURN_RING_WIDTH_PX.dm);
    expect(r.strokeScaleEnabled()).toBe(false);
    expect(r.listening()).toBe(false);

    rerender({ turnTokenId: "ghost" });
    expect(ring()!.getAttr("data-token-id")).toBe("ghost");
    expect([ring()!.x(), ring()!.y()]).toEqual([125, 25]);
    expect(ring()!.getParent()).toBe(layer());

    // The fogged 2 x 2 ogre, at another zoom: the gap stays a fixed screen size.
    rerender({ turnTokenId: "ogre", scale: 0.5 });
    expect(ring()!.getAttr("data-token-id")).toBe("ogre");
    expect([ring()!.x(), ring()!.y()]).toEqual([150, 100]);
    expect(ring()!.radius()).toBe(50 + TURN_RING_GAP_PX / 0.5);
    expect(layer().find("#turn-ring")).toHaveLength(1);
  });

  it("with a token tool the layer listens, the ring still does not", () => {
    const tool = { selectedId: "orc", onSelect: vi.fn(), onMove: vi.fn() };
    const { ring, layer } = renderLayer({ view: "dm", turnTokenId: "orc", tool });
    expect(layer().listening()).toBe(true);
    expect(ring()!.listening()).toBe(false);
  });

  it("on the player rings a visible token only, a little heavier; never a hidden or fogged one", () => {
    const { ring, rerender } = renderLayer({ view: "player", turnTokenId: "orc" });
    expect(ring()!.getAttr("data-token-id")).toBe("orc");
    expect(ring()!.strokeWidth()).toBe(TURN_RING_WIDTH_PX.player);
    expect(TURN_RING_WIDTH_PX.player).toBeGreaterThan(TURN_RING_WIDTH_PX.dm);

    rerender({ turnTokenId: "ghost" });
    expect(ring()).toBeFalsy();
    rerender({ turnTokenId: "ogre" });
    expect(ring()).toBeFalsy();

    // The ogre's last fogged cell revealed: ringed at once.
    rerender({ turnTokenId: "ogre", visibility: { ...visibility, ogre: "visible" } });
    expect(ring()!.getAttr("data-token-id")).toBe("ogre");
    // The orc under fog again, or hidden by the DM: gone.
    rerender({ turnTokenId: "orc", visibility: { ...visibility, orc: "fogged" } });
    expect(ring()).toBeFalsy();
    rerender({ turnTokenId: "orc", visibility: { ...visibility, orc: "hidden" } });
    expect(ring()).toBeFalsy();
  });
});
