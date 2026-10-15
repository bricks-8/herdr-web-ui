import { afterEach, describe, expect, it } from "bun:test";
import {
  activateSlot,
  closeSlot,
  dockPane,
  draggedPane,
  dropSide,
  dropZone,
  MAX_SPLIT_SLOTS,
  paneDragData,
  replaceSlotPane,
  resizeSplit,
  slotRects,
  slotsOf,
  splitDividers,
  storedSplit,
  storeSplit,
  zoneRect,
  type SplitChange,
  type SplitNode,
  type SplitState,
} from "./split.ts";

const A = { machineId: "local", paneId: "w1:p1" };
const B = { machineId: "local", paneId: "w2:p1" };
const C = { machineId: "pc2", paneId: "w1:p1" };
const D = { machineId: "pc2", paneId: "w2:p1" };

/** A on the left in slot a, B active on the right in slot b */
const pair: SplitState = { root: { dir: "row", ratio: 0.5, first: { slot: "a" }, second: { slot: "b" } }, panes: { a: A }, active: "b" };

describe("split layout", () => {
  it("opens a dropped pane beside the single one, on the edge it was dropped on", () => {
    expect(dockPane(null, A, B, { slot: "a", edge: "right" })).toEqual({ split: pair, solo: "b", select: B });
    const below = dockPane(null, A, B, { slot: "a", edge: "bottom" })!;
    expect(below.split!.root).toEqual({ dir: "column", ratio: 0.5, first: { slot: "a" }, second: { slot: "b" } });
    const left = dockPane(null, A, B, { slot: "a", edge: "left" })!;
    expect(slotsOf(left.split!.root)).toEqual(["b", "a"]);
  });

  it("keeps the single pane in its own slot", () => {
    // a split closed down to slot c leaves its pane there: a new pane takes the first free id
    const next = dockPane(null, A, B, { slot: "c", edge: "right" }, "c")!;
    expect(next.split).toEqual({ root: { dir: "row", ratio: 0.5, first: { slot: "c" }, second: { slot: "a" } }, panes: { c: A }, active: "a" });
  });

  it("does nothing for a pane dropped onto itself, or with nothing open", () => {
    expect(dockPane(null, A, A, { slot: "a", edge: "left" })).toBeNull();
    expect(dockPane(null, null, B, { slot: "a", edge: "left" })).toBeNull();
    expect(dockPane(pair, B, B, { slot: "b", edge: null })).toBeNull();
    expect(dockPane(pair, B, B, { slot: "b", edge: "top" })).toBeNull();
    expect(dockPane(pair, B, C, { slot: "z", edge: "top" })).toBeNull();
  });

  it("grows into three columns and a grid", () => {
    const three = dockPane(pair, B, C, { slot: "b", edge: "right" })!;
    expect(slotsOf(three.split!.root)).toEqual(["a", "b", "c"]);
    expect(three.split!.active).toBe("c");
    expect(three.split!.panes).toEqual({ a: A, b: B });
    const grid = dockPane(three.split, C, D, { slot: "a", edge: "bottom" })!;
    expect(slotsOf(grid.split!.root)).toEqual(["a", "d", "b", "c"]);
    const rects = slotRects(grid.split!.root);
    expect(rects.get("a")).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
    expect(rects.get("d")).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
    expect(rects.get("c")).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1 });
  });

  it("refuses a new pane once the area holds the most slots, but still moves the ones there", () => {
    let state: SplitState | null = null;
    let active = { machineId: "local", paneId: "p0" };
    for (let i = 1; i < MAX_SPLIT_SLOTS; i++) {
      const next: SplitChange = dockPane(state, active, { machineId: "local", paneId: `p${i}` }, { slot: state?.active ?? "a", edge: "right" })!;
      state = next.split; active = next.select;
    }
    expect(slotsOf(state!.root)).toHaveLength(MAX_SPLIT_SLOTS);
    expect(dockPane(state, active, { machineId: "local", paneId: "extra" }, { slot: "a", edge: "right" })).toBeNull();
    expect(dockPane(state, active, { machineId: "local", paneId: "extra" }, { slot: "a", edge: null })?.select).toEqual({ machineId: "local", paneId: "extra" });
    expect(dockPane(state, active, { machineId: "local", paneId: "p0" }, { slot: state!.active, edge: "bottom" })).not.toBeNull();
  });

  it("opens a pane dropped in a slot's middle there, making that slot active", () => {
    // on the active slot: it replaces the selection
    expect(dockPane(pair, B, C, { slot: "b", edge: null })).toEqual({ split: pair, solo: "b", select: C });
    // on the other slot: it opens there and that slot is active, B stays where it was
    expect(dockPane(pair, B, C, { slot: "a", edge: null })).toEqual({ split: { ...pair, panes: { b: B }, active: "a" }, solo: "a", select: C });
  });

  it("trades the slots' places when a slot's own pane is dropped in another slot's middle", () => {
    const traded: SplitNode = { dir: "row", ratio: 0.5, first: { slot: "b" }, second: { slot: "a" } };
    // the active B dropped on the left: slot b moves there with B and stays active, slot a goes right
    expect(dockPane(pair, B, B, { slot: "a", edge: null })).toEqual({ split: { ...pair, root: traded }, solo: "b", select: B });
    // A dropped on the active right: slot a moves there and is active, slot b goes left
    expect(dockPane(pair, B, A, { slot: "b", edge: null })).toEqual({ split: { root: traded, panes: { b: B }, active: "a" }, solo: "a", select: A });
  });

  it("leaves the layout alone for a slot dropped where it already is", () => {
    const narrow = resizeSplit(pair, "", 0.3);
    expect(dockPane(narrow, B, B, { slot: "a", edge: "right" })).toBeNull();
    // the other slot's pane: only made active, its share kept
    expect(dockPane(narrow, B, A, { slot: "b", edge: "left" })).toEqual({ split: { ...narrow, panes: { b: B }, active: "a" }, solo: "a", select: A });
    expect(resizeSplit(pair, "", Number.NaN)).toBe(pair);
  });

  it("moves a shown pane with its slot when it is dropped on another slot's edge", () => {
    const three = dockPane(pair, B, C, { slot: "b", edge: "right" })!.split!;
    // A (slot a) dropped below C (slot c): slot a leaves the left column and keeps its id
    const moved = dockPane(three, C, A, { slot: "c", edge: "bottom" })!;
    expect(slotsOf(moved.split!.root)).toEqual(["b", "c", "a"]);
    expect(moved.split!.active).toBe("a");
    expect(moved.select).toEqual(A);
    expect(moved.split!.panes).toEqual({ b: B, c: C });
  });

  it("makes another slot active without moving any pane", () => {
    expect(activateSlot(pair, B, "a")).toEqual({ split: { ...pair, panes: { b: B }, active: "a" }, solo: "a", select: A });
    expect(activateSlot(pair, B, "b")).toBeNull();
  });

  it("closes a slot, giving the place to its neighbour", () => {
    const three = dockPane(pair, B, C, { slot: "b", edge: "right" })!.split!;
    const closed = closeSlot(three, C, "c")!;
    expect(closed).toEqual({ split: { root: pair.root, panes: { a: A }, active: "b" }, solo: "b", select: B });
    const inactive = closeSlot(three, C, "a")!;
    expect(inactive.split!.active).toBe("c");
    expect(slotsOf(inactive.split!.root)).toEqual(["b", "c"]);
    // down to one slot: no split left, the remaining slot is the solo one
    expect(closeSlot(pair, B, "b")).toEqual({ split: null, solo: "a", select: A });
    expect(closeSlot(pair, B, "a")).toEqual({ split: null, solo: "b", select: B });
  });

  it("replaces an inactive slot's pane only", () => {
    expect(replaceSlotPane(pair, "a", C).panes).toEqual({ a: C });
    expect(replaceSlotPane(pair, "b", C)).toBe(pair);
  });

  it("resizes a split within its limits", () => {
    const three = dockPane(pair, B, C, { slot: "b", edge: "right" })!.split!;
    const dividers = splitDividers(three.root);
    expect(dividers.map((divider) => divider.path)).toEqual(["", "1"]);
    expect(dividers[1]!.area).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(slotRects(resizeSplit(three, "1", 0.3).root).get("b")!.w).toBeCloseTo(0.15);
    expect(slotRects(resizeSplit(three, "", 0.01).root).get("a")!.w).toBeCloseTo(0.15);
    expect(resizeSplit(three, "", 0.5)).toBe(three);
  });
});

describe("drop zones", () => {
  const box = { left: 100, top: 50, width: 400, height: 200 };

  it("always splits a single pane, on the nearest edge", () => {
    expect(dropZone(120, 150, box, null, "a")).toEqual({ slot: "a", edge: "left" });
    expect(dropZone(480, 150, box, null, "a")).toEqual({ slot: "a", edge: "right" });
    expect(dropZone(300, 60, box, null, "a")).toEqual({ slot: "a", edge: "top" });
    expect(dropZone(300, 240, box, null, "a")).toEqual({ slot: "a", edge: "bottom" });
  });

  it("tells a single pane's halves by its middle, kept steady within the 12px band", () => {
    expect(dropZone(299, 150, box, null, "a")).toEqual({ slot: "a", edge: "left" });
    expect(dropZone(300, 150, box, null, "a")).toEqual({ slot: "a", edge: "right" });
    expect(dropZone(312, 150, box, null, "a", { slot: "a", edge: "left" })).toEqual({ slot: "a", edge: "left" });
    expect(dropZone(313, 150, box, null, "a", { slot: "a", edge: "left" })).toEqual({ slot: "a", edge: "right" });
    expect(dropZone(288, 150, box, null, "a", { slot: "a", edge: "right" })).toEqual({ slot: "a", edge: "right" });
    // a band along the top and bottom splits above and below
    expect(dropZone(310, 95, box, null, "a", { slot: "a", edge: "left" })).toEqual({ slot: "a", edge: "top" });
  });

  it("keeps the band within narrow areas and caps it for wide ones", () => {
    expect(dropSide(30, 0, 40, "left")).toBe("left");
    expect(dropSide(31, 0, 40, "left")).toBe("right");
    expect(dropSide(1_012, 0, 2_000, "left")).toBe("left");
    expect(dropSide(1_013, 0, 2_000, "left")).toBe("right");
    expect(dropSide(-288, -500, 400, "left")).toBe("left");
    expect(dropSide(-287, -500, 400, "left")).toBe("right");
  });

  it("splits beside a slot near its edges and replaces it in its middle", () => {
    expect(dropZone(130, 150, box, pair, "b")).toEqual({ slot: "a", edge: "left" });
    expect(dropZone(200, 150, box, pair, "b")).toEqual({ slot: "a", edge: null });
    expect(dropZone(290, 150, box, pair, "b")).toEqual({ slot: "a", edge: "right" });
    expect(dropZone(400, 240, box, pair, "b")).toEqual({ slot: "b", edge: "bottom" });
  });

  it("offers only a slot's middle once the area holds the most slots", () => {
    let state: SplitState | null = null;
    let active = { machineId: "local", paneId: "p0" };
    for (let i = 1; i < MAX_SPLIT_SLOTS; i++) {
      const next: SplitChange = dockPane(state, active, { machineId: "local", paneId: `p${i}` }, { slot: state?.active ?? "a", edge: "right" })!;
      state = next.split; active = next.select;
    }
    expect(dropZone(101, 150, box, state, "a")).toEqual({ slot: "a", edge: null });
  });

  it("finds nothing outside the area", () => {
    expect(dropZone(99, 150, box, null, "a")).toBeNull();
    expect(dropZone(300, 250, box, pair, "b")).toBeNull();
  });

  it("draws the guide over the half of the slot the pane would take", () => {
    expect(zoneRect({ slot: "a", edge: "right" }, null, "a")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(zoneRect({ slot: "b", edge: "bottom" }, pair, "b")).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(zoneRect({ slot: "a", edge: null }, pair, "b")).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  it("reads only a pane's drag data", () => {
    expect(draggedPane(paneDragData(C))).toEqual(C);
    expect(draggedPane("{\"workspace_id\":\"w1\"}")).toBeNull();
    expect(draggedPane("not json")).toBeNull();
  });
});

describe("split storage", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageKey = "herdr-web-ui:split";
  const storage = (entries: Map<string, string>) => ({
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  });

  afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("stores and restores the split in session storage, not local storage", () => {
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { sessionStorage: storage(session), localStorage: storage(local) },
    });

    storeSplit(pair);
    expect(session.get(storageKey)).toBe(JSON.stringify(pair));
    expect(local.has(storageKey)).toBe(false);
    expect(storedSplit()).toEqual(pair);

    storeSplit(null);
    expect(session.has(storageKey)).toBe(false);
    expect(local.has(storageKey)).toBe(false);
  });

  it("reads the two halves an earlier version kept", () => {
    const session = new Map([[storageKey, JSON.stringify({ other: A, bSide: "right", active: "b" })]]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage(session) } });
    expect(storedSplit()).toEqual(pair);
    session.set(storageKey, JSON.stringify({ other: A, bSide: "left", active: "a" }));
    expect(storedSplit()).toEqual({ root: { dir: "row", ratio: 0.5, first: { slot: "b" }, second: { slot: "a" } }, panes: { b: A }, active: "a" });
  });

  it("drops a stored split that is not whole", () => {
    const session = new Map<string, string>();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { sessionStorage: storage(session) } });
    const broken = [
      { ...pair, panes: {} },
      { ...pair, active: "c" },
      { ...pair, root: { slot: "a" } },
      { ...pair, root: { dir: "row", ratio: 2, first: { slot: "a" }, second: { slot: "b" } } },
      { ...pair, root: { dir: "row", ratio: 0.5, first: { slot: "a" }, second: { slot: "a" } } },
    ];
    for (const value of broken) {
      session.set(storageKey, JSON.stringify(value));
      expect(storedSplit()).toBeNull();
    }
  });

  it("keeps storage access failures non-fatal", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: {
          getItem() { throw new Error("storage denied"); },
          setItem() { throw new Error("storage denied"); },
          removeItem() { throw new Error("storage denied"); },
        },
      },
    });

    expect(storedSplit()).toBeNull();
    expect(() => storeSplit(pair)).not.toThrow();
    expect(() => storeSplit(null)).not.toThrow();
  });
});
