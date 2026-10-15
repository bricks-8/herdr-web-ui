/**
 * Panes side by side and stacked on a desktop, as editor groups are: a tab or a sidebar row dragged
 * onto the pane area opens its pane beside, above or below the pane it is dropped on, or in its
 * place when dropped on its middle. The selected pane (App's) is the active slot's; every other
 * slot keeps its own.
 *
 * The layout is a tree of splits whose leaves are slots. A slot keeps its id, and with it its
 * terminals' connections, when the active one changes, when the slots trade places and when a slot
 * moves to another place in the tree: App draws every slot in one container, by a stable key, at
 * the rectangle the tree gives it. A single pane is shown in one slot (App's solo slot, `a` at
 * first); the slot left when a split ends stays, so its terminal keeps its connection.
 */

export type SplitEdge = "left" | "right" | "top" | "bottom";
/** a slot's id: one lowercase letter, kept for as long as the slot is open */
export type SplitSlot = string;

export interface SplitTarget {
  machineId: string;
  paneId: string;
}

/** `row` lays its two children out left and right, `column` top and bottom; `ratio` is the first one's share */
export type SplitNode = { slot: SplitSlot } | { dir: "row" | "column"; ratio: number; first: SplitNode; second: SplitNode };

export interface SplitState {
  root: SplitNode;
  /** the pane of every slot but the active one: the active slot's is App's selection */
  panes: Record<SplitSlot, SplitTarget>;
  /** the slot of the selected pane */
  active: SplitSlot;
}

/** where a drop lands: beside the slot on an edge, or in its place (`edge` null) */
export interface DropZone {
  slot: SplitSlot;
  edge: SplitEdge | null;
}

/** a rectangle as fractions of the pane area */
export interface SplitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a boundary between two children of a split: `path` names the split, `area` is its rectangle */
export interface SplitDivider {
  path: string;
  dir: "row" | "column";
  ratio: number;
  area: SplitRect;
}

/** more slots than this are too narrow for a terminal on a laptop's screen */
export const MAX_SPLIT_SLOTS = 6;
/** a slot never gets less than this share of the split it is in */
export const MIN_SPLIT_RATIO = 0.15;
/** a drop this close to a slot's edge (as a share of its size) opens the pane beside it */
const EDGE_BAND = 0.25;

/** what a dragged tab or sidebar row carries: the pane it opens, and the PC it is on */
export const PANE_DRAG_TYPE = "application/x-herdr-pane";

const STORAGE_KEY = "herdr-web-ui:split";
const SLOT_ID = /^[a-z]$/;
const FULL: SplitRect = { x: 0, y: 0, w: 1, h: 1 };

export function sameTarget(a: SplitTarget | null | undefined, b: SplitTarget | null | undefined): boolean {
  return !!a && !!b && a.machineId === b.machineId && a.paneId === b.paneId;
}

const isLeaf = (node: SplitNode): node is { slot: SplitSlot } => "slot" in node;

/** The slots in the tree, in reading order. */
export function slotsOf(node: SplitNode): SplitSlot[] {
  return isLeaf(node) ? [node.slot] : [...slotsOf(node.first), ...slotsOf(node.second)];
}

/** Where each slot is drawn, as fractions of the pane area. */
export function slotRects(root: SplitNode): Map<SplitSlot, SplitRect> {
  const rects = new Map<SplitSlot, SplitRect>();
  const walk = (node: SplitNode, rect: SplitRect): void => {
    if (isLeaf(node)) { rects.set(node.slot, rect); return; }
    const [first, second] = halves(node, rect);
    walk(node.first, first);
    walk(node.second, second);
  };
  walk(root, FULL);
  return rects;
}

function halves(node: { dir: "row" | "column"; ratio: number }, rect: SplitRect): [SplitRect, SplitRect] {
  if (node.dir === "row") {
    const w = rect.w * node.ratio;
    return [{ ...rect, w }, { ...rect, x: rect.x + w, w: rect.w - w }];
  }
  const h = rect.h * node.ratio;
  return [{ ...rect, h }, { ...rect, y: rect.y + h, h: rect.h - h }];
}

/** Every boundary that can be dragged. A path is the turns from the root: `0` first, `1` second. */
export function splitDividers(root: SplitNode): SplitDivider[] {
  const dividers: SplitDivider[] = [];
  const walk = (node: SplitNode, rect: SplitRect, path: string): void => {
    if (isLeaf(node)) return;
    dividers.push({ path, dir: node.dir, ratio: node.ratio, area: rect });
    const [first, second] = halves(node, rect);
    walk(node.first, first, `${path}0`);
    walk(node.second, second, `${path}1`);
  };
  walk(root, FULL, "");
  return dividers;
}

/** The tree's shape without its shares: a boundary's path names the same split while this holds. */
export function splitShape(node: SplitNode): string {
  return isLeaf(node) ? node.slot : `${node.dir}(${splitShape(node.first)},${splitShape(node.second)})`;
}

/** The split at `path` set to `ratio`, kept within MIN_SPLIT_RATIO of either end. */
export function resizeSplit(state: SplitState, path: string, ratio: number): SplitState {
  if (!Number.isFinite(ratio)) return state;
  const clamped = Math.min(1 - MIN_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
  const walk = (node: SplitNode, rest: string): SplitNode => {
    if (isLeaf(node)) return node;
    if (rest === "") return node.ratio === clamped ? node : { ...node, ratio: clamped };
    const turn = rest[0] === "0" ? "first" : "second";
    const child = walk(node[turn], rest.slice(1));
    return child === node[turn] ? node : { ...node, [turn]: child };
  };
  const root = walk(state.root, path);
  return root === state.root ? state : { ...state, root };
}

function insertBeside(root: SplitNode, at: SplitSlot, slot: SplitSlot, edge: SplitEdge): SplitNode {
  if (isLeaf(root)) {
    if (root.slot !== at) return root;
    const added = { slot };
    const before = edge === "left" || edge === "top";
    return { dir: edge === "left" || edge === "right" ? "row" : "column", ratio: 0.5, first: before ? added : root, second: before ? root : added };
  }
  return { ...root, first: insertBeside(root.first, at, slot, edge), second: insertBeside(root.second, at, slot, edge) };
}

/** The tree without `slot` (its sibling takes the split's place), and the slot nearest where it was. */
function removeSlot(root: SplitNode, slot: SplitSlot): { root: SplitNode | null; heir: SplitSlot | null } {
  if (isLeaf(root)) return root.slot === slot ? { root: null, heir: null } : { root, heir: null };
  const first = removeSlot(root.first, slot);
  if (first.root === null) return { root: root.second, heir: slotsOf(root.second)[0] ?? null };
  const second = removeSlot(root.second, slot);
  if (second.root === null) return { root: root.first, heir: slotsOf(root.first).at(-1) ?? null };
  return { root: { ...root, first: first.root, second: second.root }, heir: first.heir ?? second.heir };
}

/** The tree without `drop`'s slots: the same node when none of them is in it, null when nothing is left. */
export function pruneSlots(root: SplitNode, drop: ReadonlySet<SplitSlot>): SplitNode | null {
  if (isLeaf(root)) return drop.has(root.slot) ? null : root;
  const first = pruneSlots(root.first, drop);
  const second = pruneSlots(root.second, drop);
  if (first === null) return second;
  if (second === null) return first;
  return first === root.first && second === root.second ? root : { ...root, first, second };
}

/** The tree with two leaves trading places: their slots move, and keep their ids. */
function swapLeaves(root: SplitNode, one: SplitSlot, other: SplitSlot): SplitNode {
  if (isLeaf(root)) return root.slot === one ? { slot: other } : root.slot === other ? { slot: one } : root;
  return { ...root, first: swapLeaves(root.first, one, other), second: swapLeaves(root.second, one, other) };
}

/** `slot` is already the sibling on `edge` of `at`, in a split of that direction. */
function besideAlready(root: SplitNode, at: SplitSlot, slot: SplitSlot, edge: SplitEdge): boolean {
  if (isLeaf(root)) return false;
  if (isLeaf(root.first) && isLeaf(root.second) && root.dir === (edge === "left" || edge === "right" ? "row" : "column")) {
    const before = edge === "left" || edge === "top";
    if ((before ? root.first.slot : root.second.slot) === slot && (before ? root.second.slot : root.first.slot) === at) return true;
  }
  return besideAlready(root.first, at, slot, edge) || besideAlready(root.second, at, slot, edge);
}

function freeSlot(used: SplitSlot[]): SplitSlot | null {
  for (let code = 97; code <= 122; code++) {
    const slot = String.fromCharCode(code);
    if (!used.includes(slot)) return slot;
  }
  return null;
}

/** Each slot's pane, the active one's included. */
function contents(state: SplitState, active: SplitTarget): Map<SplitSlot, SplitTarget> {
  const map = new Map<SplitSlot, SplitTarget>();
  for (const slot of slotsOf(state.root)) map.set(slot, slot === state.active ? active : state.panes[slot]!);
  return map;
}

/**
 * A split change: `split` null with `solo` when one slot is left. `select` is the pane the active
 * slot then shows, which App selects.
 */
export interface SplitChange {
  split: SplitState | null;
  solo: SplitSlot;
  select: SplitTarget;
}

function settle(root: SplitNode, map: Map<SplitSlot, SplitTarget>, active: SplitSlot): SplitChange {
  const select = map.get(active)!;
  const slots = slotsOf(root);
  if (slots.length === 1) return { split: null, solo: slots[0]!, select };
  const panes: Record<SplitSlot, SplitTarget> = {};
  for (const slot of slots) if (slot !== active) panes[slot] = map.get(slot)!;
  return { split: { root, panes, active }, solo: active, select };
}

/** The state of one pane in its solo slot, so a single pane and a split take the same steps. */
function soloState(solo: SplitSlot): SplitState {
  return { root: { slot: solo }, panes: {}, active: solo };
}

/**
 * A pane dropped on a zone: the split after it, and the pane to select (the dropped one, whose slot
 * becomes the active one). Null when nothing changes: a pane dropped where it already is, a new
 * pane when the area holds MAX_SPLIT_SLOTS, or nothing open.
 * - On an edge: the dropped pane opens beside that slot. A pane a slot already shows moves there
 *   with its slot, so its terminal stays attached.
 * - In the middle: the dropped pane opens in that slot. A slot's own pane dropped on another slot
 *   trades places with it, both slots keeping their terminals.
 * `dragged` is the pane a slot shows when it is a pane of that slot's tab (App resolves it).
 */
export function dockPane(
  state: SplitState | null,
  active: SplitTarget | null,
  dragged: SplitTarget,
  zone: DropZone,
  solo: SplitSlot = "a",
): SplitChange | null {
  if (active === null) return null;
  const now = state ?? soloState(solo);
  const slots = slotsOf(now.root);
  if (!slots.includes(zone.slot)) return null;
  const map = contents(now, active);
  const from = slots.find((slot) => sameTarget(map.get(slot), dragged));
  if (zone.edge === null) {
    if (from === zone.slot) return from === now.active ? null : settle(now.root, map, from);
    // a pane another slot shows: the two slots trade places, each keeping its terminals
    if (from !== undefined) return settle(swapLeaves(now.root, from, zone.slot), map, from);
    map.set(zone.slot, dragged);
    return settle(now.root, map, zone.slot);
  }
  if (from !== undefined) {
    if (from === zone.slot) return null;
    if (besideAlready(now.root, zone.slot, from, zone.edge)) return from === now.active ? null : settle(now.root, map, from);
    const without = removeSlot(now.root, from).root;
    if (without === null) return null;
    return settle(insertBeside(without, zone.slot, from, zone.edge), map, from);
  }
  if (slots.length >= MAX_SPLIT_SLOTS) return null;
  const added = freeSlot(slots);
  if (added === null) return null;
  map.set(added, dragged);
  return settle(insertBeside(now.root, zone.slot, added, zone.edge), map, added);
}

/** Another slot made active: a click in it. */
export function activateSlot(state: SplitState, active: SplitTarget, slot: SplitSlot): SplitChange | null {
  if (slot === state.active || !(slot in state.panes)) return null;
  return settle(state.root, contents(state, active), slot);
}

/** A slot closed: its pane stays open in herdr, and the slot nearest it is active when it was. */
export function closeSlot(state: SplitState, active: SplitTarget, slot: SplitSlot): SplitChange | null {
  const { root, heir } = removeSlot(state.root, slot);
  if (root === null || heir === null) return null;
  const map = contents(state, active);
  map.delete(slot);
  return settle(root, map, slot === state.active ? heir : state.active);
}

/** A slot's pane replaced (its pane closed and another of its tab takes its place). */
export function replaceSlotPane(state: SplitState, slot: SplitSlot, target: SplitTarget): SplitState {
  if (slot === state.active || !(slot in state.panes)) return state;
  return { ...state, panes: { ...state.panes, [slot]: target } };
}

/** Keep the preview's side near the midpoint; a first entry uses the exact half. */
export function dropSide(x: number, left: number, width: number, previous: "left" | "right" | null = null): "left" | "right" {
  const middle = left + width / 2;
  const margin = Math.min(12, width / 4);
  if (previous === "left" && x <= middle + margin) return "left";
  if (previous === "right" && x >= middle - margin) return "right";
  return x < middle ? "left" : "right";
}

/**
 * The zone under a point of the pane area (`box`, in the same coordinates as the point). With one
 * pane every drop is beside it: above or below in a band along its top and bottom, else on the half
 * the pointer is over, kept steady around the midpoint. With several, a slot's edge band opens the
 * pane beside it and its middle opens the pane in its place.
 */
export function dropZone(
  x: number,
  y: number,
  box: { left: number; top: number; width: number; height: number },
  state: SplitState | null,
  solo: SplitSlot,
  previous: DropZone | null = null,
): DropZone | null {
  // a full area takes no new slot: only a slot's middle, where a pane opens in its place
  const full = state !== null && slotsOf(state.root).length >= MAX_SPLIT_SLOTS;
  if (box.width <= 0 || box.height <= 0) return null;
  const px = (x - box.left) / box.width;
  const py = (y - box.top) / box.height;
  if (px < 0 || px >= 1 || py < 0 || py >= 1) return null;
  const rects = state ? slotRects(state.root) : new Map([[solo, FULL]]);
  for (const [slot, rect] of rects) {
    if (px < rect.x || px >= rect.x + rect.w || py < rect.y || py >= rect.y + rect.h) continue;
    const u = (px - rect.x) / rect.w;
    const v = (py - rect.y) / rect.h;
    const distances: [SplitEdge, number][] = [["left", u], ["right", 1 - u], ["top", v], ["bottom", 1 - v]];
    const [edge, distance] = distances.reduce((best, next) => (next[1] < best[1] ? next : best));
    if (state === null) {
      const vertical = Math.min(v, 1 - v);
      if (vertical < EDGE_BAND && vertical < Math.min(u, 1 - u)) return { slot, edge: v < 0.5 ? "top" : "bottom" };
      const kept = previous?.slot === slot && (previous.edge === "left" || previous.edge === "right") ? previous.edge : null;
      return { slot, edge: dropSide(x, box.left, box.width, kept) };
    }
    return { slot, edge: distance < EDGE_BAND && !full ? edge : null };
  }
  return null;
}

/** The rectangle a zone's guide fills: the half of the slot the pane would take, or all of it. */
export function zoneRect(zone: DropZone, state: SplitState | null, solo: SplitSlot): SplitRect | null {
  const rect = state ? slotRects(state.root).get(zone.slot) : zone.slot === solo ? FULL : undefined;
  if (!rect) return null;
  switch (zone.edge) {
    case null: return rect;
    case "left": return { ...rect, w: rect.w / 2 };
    case "right": return { ...rect, x: rect.x + rect.w / 2, w: rect.w / 2 };
    case "top": return { ...rect, h: rect.h / 2 };
    case "bottom": return { ...rect, y: rect.y + rect.h / 2, h: rect.h / 2 };
  }
}

/** A pane dragged in, if the drag carries one. */
export function draggedPane(data: string): SplitTarget | null {
  try {
    const value = JSON.parse(data) as { machine_id?: unknown; pane_id?: unknown };
    return typeof value.machine_id === "string" && typeof value.pane_id === "string" ? { machineId: value.machine_id, paneId: value.pane_id } : null;
  } catch {
    return null;
  }
}

export function paneDragData(target: SplitTarget): string {
  return JSON.stringify({ machine_id: target.machineId, pane_id: target.paneId });
}

function readTarget(value: unknown): SplitTarget | null {
  const target = value as Partial<SplitTarget> | null;
  return target && typeof target.machineId === "string" && typeof target.paneId === "string" ? { machineId: target.machineId, paneId: target.paneId } : null;
}

function readNode(value: unknown, depth = 0): SplitNode | null {
  if (depth > MAX_SPLIT_SLOTS || value === null || typeof value !== "object") return null;
  const node = value as { slot?: unknown; dir?: unknown; ratio?: unknown; first?: unknown; second?: unknown };
  if (typeof node.slot === "string") return SLOT_ID.test(node.slot) ? { slot: node.slot } : null;
  if (node.dir !== "row" && node.dir !== "column") return null;
  if (typeof node.ratio !== "number" || !(node.ratio >= MIN_SPLIT_RATIO && node.ratio <= 1 - MIN_SPLIT_RATIO)) return null;
  const first = readNode(node.first, depth + 1);
  const second = readNode(node.second, depth + 1);
  return first && second ? { dir: node.dir, ratio: node.ratio, first, second } : null;
}

/** The split this device left, if any: a reload opens it again while its panes are still there. */
export function storedSplit(): SplitState | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return null;
    // the two halves an earlier version kept: slot b on one side, the other slot's pane
    if ("other" in value) {
      const other = readTarget(value.other);
      if (!other || (value.bSide !== "left" && value.bSide !== "right") || (value.active !== "a" && value.active !== "b")) return null;
      const b = { slot: "b" }, a = { slot: "a" };
      return {
        root: { dir: "row", ratio: 0.5, first: value.bSide === "left" ? b : a, second: value.bSide === "left" ? a : b },
        panes: { [value.active === "a" ? "b" : "a"]: other },
        active: value.active,
      };
    }
    const root = readNode(value.root);
    if (!root || typeof value.active !== "string") return null;
    const slots = slotsOf(root);
    if (slots.length < 2 || slots.length > MAX_SPLIT_SLOTS || new Set(slots).size !== slots.length || !slots.includes(value.active)) return null;
    const stored = (value.panes ?? {}) as Record<string, unknown>;
    const panes: Record<SplitSlot, SplitTarget> = {};
    for (const slot of slots) {
      if (slot === value.active) continue;
      const target = readTarget(stored[slot]);
      if (!target) return null;
      panes[slot] = target;
    }
    return { root, panes, active: value.active };
  } catch {
    return null;
  }
}

export function storeSplit(state: SplitState | null): void {
  try {
    if (state === null) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the split just is not kept across a reload */
  }
}
