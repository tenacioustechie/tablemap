/**
 * Annotation panel and the drawing / note tools, driven through `DmView`
 * so the panel, the canvas and the store are exercised together (the
 * visibility rules, the wire filter and the actions have their own unit
 * tests). Dragging a note marker needs Konva hit testing, which jsdom
 * cannot do; the popover, placement, text edits and deletion are covered.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { nanoid } from "nanoid";
import { MemoryRouter } from "react-router-dom";
import { createAnnotationActions } from "../state/annotationActions";
import { TableMapDb } from "../state/db";
import { createBlankMapScene } from "../state/maps";
import { initialSharedState } from "../state/shared";
import { createTableStore, type TableStore } from "../state/store";
import { noteLabel } from "./AnnotationPanel";
import { DEFAULT_DRAW_TOOL_SETTINGS, ERASER_RADIUS_PX } from "./annotationTool";
import { DmView } from "./DmView";
import type { PlayerWindowController } from "./playerWindow";

const noWindow: PlayerWindowController = {
  open: () => null,
  close: () => {},
  isOpen: () => false,
  isFullscreen: () => false,
  toggleFullscreen: async () => "not-open",
  getHandle: () => null,
};

function renderDm(store: TableStore) {
  const db = new TableMapDb(`tablemap-test-${nanoid()}`);
  let n = 0;
  const actions = createAnnotationActions(store, { newId: () => `a${++n}` });
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <DmView store={store} db={db} playerWindow={noWindow} annotationActions={actions} />
    </MemoryRouter>
  );
  return actions;
}

function storeWithMaps(activeMapId: string | null = "a") {
  const a = createBlankMapScene({ id: "a", name: "A", columns: 10, rows: 8, cellSize: 50 });
  const b = createBlankMapScene({ id: "b", name: "B", columns: 4, rows: 4, cellSize: 50 });
  return createTableStore({ ...initialSharedState(), maps: [a, b], activeMapId });
}

const annotationsOf = (store: TableStore, id = "a") =>
  store.getState().shared.maps.find((m) => m.id === id)!.annotations;
const stageContent = () => screen.getByTestId("dm-map-stage").querySelector(".konvajs-content")!;
const stage = () => screen.getByTestId("dm-map-stage");
const surface = () => screen.getByTestId("dm-canvas-surface");

/** Zero-size container => identity viewport, so screen px == map px. */
function drag(points: [number, number][], init: Record<string, unknown> = {}) {
  const [first, ...rest] = points;
  fireEvent.mouseDown(stageContent(), { clientX: first[0], clientY: first[1], ...init });
  for (const [x, y] of rest) fireEvent.mouseMove(stageContent(), { clientX: x, clientY: y, ...init });
  const last = points[points.length - 1];
  fireEvent.mouseUp(stageContent(), { clientX: last[0], clientY: last[1], ...init });
}

describe("AnnotationPanel via DmView (T011)", () => {
  it("asks for a map when none is shown", () => {
    renderDm(storeWithMaps(null));
    expect(screen.getByTestId("annotation-panel").textContent).toMatch(/show a map/i);
    expect(screen.queryByTestId("draw-mode-draw")).toBeNull();
  });

  it("draws strokes with the chosen colour, width and visibility; a click is a dot; Esc and Stop end the tool", () => {
    const store = storeWithMaps();
    renderDm(store);
    expect(surface().dataset.drawing).toBe("false");
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    expect(surface().dataset.drawing).toBe("draw");
    expect(stage().dataset.tool).toBe("active");
    expect(surface().dataset.tokenTool).toBe("none");
    expect(screen.getByTestId("draw-hint").textContent).toMatch(/both views/);

    drag([
      [10, 10],
      [11, 10], // under the 3 px step: dropped
      [60, 10],
      [60, 60],
    ]);
    expect(annotationsOf(store)).toEqual([
      {
        id: "a1",
        kind: "drawing",
        points: [10, 10, 60, 10, 60, 60],
        color: DEFAULT_DRAW_TOOL_SETTINGS.color,
        strokeWidth: DEFAULT_DRAW_TOOL_SETTINGS.strokeWidth,
        visibility: "all",
      },
    ]);
    expect(stage().dataset.annotations).toBe("1");
    expect(stage().dataset.annotationsShown).toBe("1");

    fireEvent.change(screen.getByTestId("draw-color"), { target: { value: "#00ff00" } });
    fireEvent.change(screen.getByTestId("draw-width"), { target: { value: "12" } });
    expect(screen.getByTestId("draw-width-value").textContent).toBe("12");
    fireEvent.change(screen.getByTestId("draw-visibility"), { target: { value: "dm" } });
    expect(screen.getByTestId("draw-hint").textContent).toMatch(/DM only/);
    drag([[100, 100]]);
    expect(annotationsOf(store)[1]).toEqual({
      id: "a2",
      kind: "drawing",
      points: [100, 100],
      color: "#00ff00",
      strokeWidth: 12,
      visibility: "dm",
    });
    expect(screen.getByTestId("draw-clear").textContent).toContain("(2)");

    // A palette swatch sets the colour too.
    fireEvent.click(screen.getAllByTestId("draw-swatch")[1]);
    expect((screen.getByTestId("draw-color") as HTMLInputElement).value).toBe("#ffcc00");

    // Esc in the middle of a stroke abandons it; Esc when idle leaves the tool.
    fireEvent.mouseDown(stageContent(), { clientX: 5, clientY: 5 });
    fireEvent.mouseMove(stageContent(), { clientX: 50, clientY: 50 });
    expect(surface().dataset.drawGesture).toBe("dragging");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.drawGesture).toBe("idle");
    fireEvent.mouseUp(stageContent(), { clientX: 50, clientY: 50 });
    expect(annotationsOf(store)).toHaveLength(2);
    expect(surface().dataset.drawing).toBe("draw");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.drawing).toBe("false");

    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    fireEvent.click(screen.getByTestId("annotation-stop"));
    expect(surface().dataset.drawing).toBe("false");
    // Clicking the active mode again turns it off as well.
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    expect(surface().dataset.drawing).toBe("false");
  });

  it("the eraser removes whole strokes under the pointer as it drags; clear removes them all", () => {
    const store = storeWithMaps();
    const actions = renderDm(store);
    act(() => {
      actions.addDrawing("a", { points: [0, 100, 200, 100], color: "#f00", strokeWidth: 4, visibility: "all" });
      actions.addDrawing("a", { points: [300, 0, 300, 200], color: "#f00", strokeWidth: 4, visibility: "dm" });
      actions.addDrawing("a", { points: [400, 300, 450, 350], color: "#f00", strokeWidth: 4, visibility: "all" });
      actions.addNote("a", { x: 100, y: 100 }, "keep me");
    });
    fireEvent.click(screen.getByTestId("draw-mode-erase"));
    expect(surface().dataset.drawing).toBe("erase");
    expect(screen.getByTestId("draw-hint").textContent).toMatch(/Eraser/);
    // Press just beside the horizontal stroke (within the eraser's reach), then drag across the vertical one.
    drag([
      [100, 100 + ERASER_RADIUS_PX],
      [300 + ERASER_RADIUS_PX - 1, 150],
    ]);
    expect(annotationsOf(store).map((a) => a.id)).toEqual(["a3", "a4"]);
    // Moving without the button down erases nothing.
    fireEvent.mouseMove(stageContent(), { clientX: 420, clientY: 320 });
    expect(annotationsOf(store)).toHaveLength(2);

    fireEvent.click(screen.getByTestId("draw-clear"));
    expect(annotationsOf(store).map((a) => a.kind)).toEqual(["note"]);
    expect((screen.getByTestId("draw-clear") as HTMLButtonElement).disabled).toBe(true);
  });

  it("places a note with a click, opens its popover, edits the text, lists it, and deletes it", () => {
    const store = storeWithMaps();
    renderDm(store);
    expect(screen.getByTestId("note-count").textContent).toBe("(0)");
    fireEvent.click(screen.getByTestId("note-tool"));
    expect(surface().dataset.noteTool).toBe("placing");
    expect(screen.getByTestId("note-hint")).toBeTruthy();
    drag([[120, 80]]);
    expect(annotationsOf(store)).toEqual([
      { id: "a1", kind: "note", x: 120, y: 80, text: "", visibility: "dm" },
    ]);
    // The tool turns itself off and the new note's popover opens.
    expect(surface().dataset.noteTool).toBe("none");
    expect(surface().dataset.noteOpen).toBe("a1");
    expect(surface().dataset.notes).toBe("1");
    expect(screen.getByTestId("note-popover").dataset.noteId).toBe("a1");
    // The stage draws no annotation for a note on either view; the marker is DM chrome.
    expect(stage().dataset.annotations).toBe("1");
    expect(stage().dataset.annotationsShown).toBe("0");

    fireEvent.change(screen.getByTestId("note-text"), { target: { value: "Trap under the rug\nDC 15" } });
    expect(annotationsOf(store)[0]).toMatchObject({ text: "Trap under the rug\nDC 15" });
    expect(screen.getByTestId("note-count").textContent).toBe("(1)");
    const item = screen.getByTestId("note-item");
    expect(item.dataset.selected).toBe("true");
    expect(within(item).getByRole("button", { name: /Open note/ }).textContent).toBe("Trap under the rug");

    fireEvent.click(screen.getByTestId("note-popover-close"));
    expect(screen.queryByTestId("note-popover")).toBeNull();
    expect(surface().dataset.noteOpen).toBe("");
    fireEvent.click(within(screen.getByTestId("note-item")).getByRole("button", { name: /Open note/ }));
    expect(screen.getByTestId("note-popover")).toBeTruthy();
    fireEvent.click(within(screen.getByTestId("note-item")).getByRole("button", { name: /Open note/ }));
    expect(screen.queryByTestId("note-popover")).toBeNull();

    // Esc leaves the placing tool without placing.
    fireEvent.click(screen.getByTestId("note-tool"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(surface().dataset.noteTool).toBe("none");
    expect(annotationsOf(store)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("note-tool"));
    drag([[20, 20]]);
    expect(screen.getAllByTestId("note-item")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("note-popover-delete"));
    expect(annotationsOf(store).map((a) => a.id)).toEqual(["a1"]);
    expect(screen.queryByTestId("note-popover")).toBeNull();
    fireEvent.click(screen.getByTestId("note-delete"));
    expect(annotationsOf(store)).toEqual([]);
    expect(screen.queryByTestId("note-list")).toBeNull();
  });

  it("an Alt-click pings the active map, whatever tool is on, and never adds an annotation", () => {
    const store = storeWithMaps();
    renderDm(store);
    const sent: string[] = [];
    store.onPing((p) => sent.push(`${p.mapId}:${p.x},${p.y}`));
    const altClick = (x: number, y: number) => {
      drag([[x, y]], { altKey: true });
      fireEvent.click(stageContent(), { clientX: x, clientY: y, altKey: true });
    };
    altClick(30, 40);
    expect(sent).toEqual(["a:30,40"]);
    expect(store.getState().pings).toHaveLength(1);
    expect(stage().dataset.pings).toBe("1");

    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    altClick(50, 60);
    expect(sent).toEqual(["a:30,40", "a:50,60"]);
    expect(annotationsOf(store)).toEqual([]);
    fireEvent.click(screen.getByTestId("note-tool"));
    altClick(70, 80);
    expect(sent).toHaveLength(3);
    expect(annotationsOf(store)).toEqual([]);
    expect(surface().dataset.noteTool).toBe("placing");
  });

  it("tools are exclusive and end on a map switch; the open note follows the active map", () => {
    const store = storeWithMaps();
    const actions = renderDm(store);
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    expect(surface().dataset.fogging).toBe("false");
    expect(surface().dataset.drawing).toBe("draw");
    fireEvent.click(screen.getByTestId("note-tool"));
    expect(surface().dataset.drawing).toBe("false");
    expect(surface().dataset.noteTool).toBe("placing");
    fireEvent.click(screen.getByTestId("fog-tool-brush"));
    expect(surface().dataset.noteTool).toBe("none");
    expect(surface().dataset.fogging).toBe("reveal");

    let note: string | undefined;
    act(() => {
      note = actions.addNote("a", { x: 1, y: 1 }, "A's note")?.id;
    });
    fireEvent.click(screen.getByRole("button", { name: /Open note A's note/ }));
    expect(surface().dataset.noteOpen).toBe(note);
    fireEvent.click(screen.getByTestId("draw-mode-draw"));
    act(() => {
      store.getState().dispatch({ kind: "map/set-active", id: "b" });
    });
    expect(surface().dataset.drawing).toBe("false");
    expect(surface().dataset.noteOpen).toBe("");
    expect(screen.queryByTestId("note-item")).toBeNull();
    expect(screen.getByTestId("note-count").textContent).toBe("(0)");
  });

  it("noteLabel shows the first non-empty line or a placeholder", () => {
    expect(noteLabel("")).toBe("(empty note)");
    expect(noteLabel("  \n\nSecond line\nThird")).toBe("Second line");
    expect(noteLabel("One")).toBe("One");
  });
});
