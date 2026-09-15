/**
 * The DM canvas's vision preview (T106): while a seeing token is dragged, the
 * canvas draws what it would see where it would land — tinted in the
 * overlay and punched through the fog — computed once per animation frame
 * from the latest position, and drops it on release or when the tokens stop
 * being draggable. A blind token shows none, and nothing is dispatched.
 *
 * Konva cannot hit-test under jsdom, so a drag is delivered the way Konva
 * would: the token node is moved and its `dragmove` / `dragend` fired.
 */
import { act, render, screen } from "@testing-library/react";
import Konva from "konva";
import { nanoid } from "nanoid";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import type { MapScene } from "../state/model";
import { initialSharedState } from "../state/shared";
import { createTableStore } from "../state/store";
import { createToken } from "../state/tokens";
import { tokenVisionPolygon } from "../state/vision";
import { createWall } from "../state/walls";
import { DmCanvas } from "./DmCanvas";
import { DEFAULT_FOG_TOOL_SETTINGS } from "./fogTool";

const disc = { type: "disc" as const, color: "#f00" };

/** A 500 x 400 map cut by a wall at x = 250, a seeing token and a blind one left of it. */
function setup() {
  const map: MapScene = {
    ...createBlankMapScene({ id: "a", columns: 10, rows: 8, cellSize: 50 }),
    walls: [createWall({ id: "w", x1: 250, y1: 0, x2: 250, y2: 400 })],
    tokens: [
      createToken({ id: "seer", x: 100, y: 100, appearance: disc, vision: 6 }),
      createToken({ id: "blind", x: 100, y: 250, appearance: disc }),
    ],
  };
  const store = createTableStore({ ...initialSharedState(), maps: [map], activeMapId: "a" });
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  const tokens = { selectedId: null, onSelect: vi.fn(), onMove: vi.fn() };
  const utils = render(<DmCanvas store={store} db={db} tokens={tokens} />);
  return { ...utils, store, db, tokens };
}

const surface = () => screen.getByTestId("dm-canvas-surface");
const konvaStage = () =>
  Konva.stages.find((s) => screen.getByTestId("dm-map-stage").contains(s.container()))!;
const tokenNode = (id: string) => konvaStage().findOne<Konva.Group>(`#token-${id}`)!;
/** One drag move: the node where the pointer took it. */
const dragTo = (id: string, x: number, y: number) =>
  act(() => {
    const node = tokenNode(id);
    node.position({ x, y });
    node.fire("dragmove", { evt: new MouseEvent("mousemove") });
  });
const drop = (id: string) =>
  act(() => {
    tokenNode(id).fire("dragend", { evt: new MouseEvent("mouseup") });
  });
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const xsOf = (points: number[]) => points.filter((_, i) => i % 2 === 0);

describe("DmCanvas vision preview (T106)", () => {
  it("dragging a seeing token previews what it would see where it would land, once per frame, and dispatches nothing until the drop", async () => {
    const { store, tokens } = setup();
    const seq = store.getState().seq;
    expect(surface().dataset.visionPreview).toBe("0");

    dragTo("seer", 140, 90); // lands on (150, 100)
    dragTo("seer", 190, 160); // lands on (200, 150): the frame uses the latest
    expect(surface().dataset.visionPreview).toBe("0"); // not before the frame
    await nextFrame();

    const scene = store.getState().shared.maps[0];
    const expected = tokenVisionPolygon(scene, { ...scene.tokens[0], x: 200, y: 150 });
    expect(expected.length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...xsOf(expected))).toBeLessThanOrEqual(250 + 1e-6); // the wall bounds it
    expect(surface().dataset.visionPreview).toBe(String(expected.length / 2));
    const outline = konvaStage().findOne<Konva.Line>(".vision-preview")!;
    expect(outline.points()).toEqual(expected);
    expect(outline.closed()).toBe(true);
    const punch = konvaStage().findOne<Konva.Line>(".vision-preview-reveal")!;
    expect(punch.points()).toEqual(expected);
    expect(punch.globalCompositeOperation()).toBe("destination-out");
    expect(punch.getLayer()?.name()).toBe("fog");
    expect(store.getState().seq).toBe(seq);
    expect(tokens.onMove).not.toHaveBeenCalled();

    drop("seer");
    expect(tokens.onMove).toHaveBeenCalledWith("seer", { x: 200, y: 150 });
    expect(surface().dataset.visionPreview).toBe("0");
    expect(konvaStage().findOne(".vision-preview")).toBeFalsy();
    expect(konvaStage().findOne(".vision-preview-reveal")).toBeFalsy();
    // The canvas dispatches nothing itself: the drop is the view's to commit.
    expect(store.getState().seq).toBe(seq);
    await nextFrame();
    expect(surface().dataset.visionPreview).toBe("0");
  });

  it("a blind token shows no preview; arming a tool drops a preview in progress", async () => {
    const { store, db, tokens, rerender } = setup();
    dragTo("blind", 160, 260);
    await nextFrame();
    expect(surface().dataset.visionPreview).toBe("0");
    expect(konvaStage().findOne(".vision-preview")).toBeFalsy();

    dragTo("seer", 100, 100);
    await nextFrame();
    expect(Number(surface().dataset.visionPreview)).toBeGreaterThanOrEqual(3);

    rerender(
      <DmCanvas
        store={store}
        db={db}
        tokens={tokens}
        fog={{ settings: DEFAULT_FOG_TOOL_SETTINGS, onShape: vi.fn(), onCancel: vi.fn() }}
      />
    );
    expect(surface().dataset.tokenTool).toBe("none");
    expect(surface().dataset.visionPreview).toBe("0");
    expect(konvaStage().findOne(".vision-preview-reveal")).toBeFalsy();
  });
});
