import { linkSearch } from "./deepLink.ts";
import type { SplitTarget } from "./split.ts";

/**
 * A pane opened in a window of its own, to place on another screen and split there again. The window
 * opens blank first: a browser that blocked it says so (null) before anything here changes. Its copy
 * of this window's session storage is cleared and its opener let go before it loads the app, so it
 * starts with the pane alone instead of this window's split (lib/split.ts) and keeps its own after.
 * Without the browser's window management permission a window opens on this window's screen, so
 * one meant for another screen is moved there by hand.
 */

/** where a window opens, in screen pixels: its top left corner */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WindowFrame {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
}

/** A point of the screen outside the window: where a drag let go of a pane to tear it off. */
export function outsideWindow(point: ScreenPoint, frame: WindowFrame): boolean {
  // a drag end some systems report with no position at all
  if (point.x === 0 && point.y === 0) return false;
  return point.x < frame.screenX || point.x >= frame.screenX + frame.outerWidth
    || point.y < frame.screenY || point.y >= frame.screenY + frame.outerHeight;
}

/** The address of the app showing one pane, from this window's own path. */
export function paneWindowUrl(target: SplitTarget, location: { origin: string; pathname: string }): string {
  const search = linkSearch({ machine: target.machineId, workspace: null, pane: target.paneId, view: null, settings: null });
  return `${location.origin}${location.pathname}${search}`;
}

/** The window's features: a window of its own, at `at` (a little up and left of it, under the pointer) or beside this one. */
export function paneWindowFeatures(frame: WindowFrame, at: ScreenPoint | null): string {
  const width = Math.max(640, Math.round(frame.outerWidth * 0.6));
  const height = Math.max(480, frame.outerHeight);
  const left = at ? at.x - 160 : frame.screenX + Math.round(frame.outerWidth * 0.4);
  const top = at ? at.y - 24 : frame.screenY;
  return `popup,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)}`;
}

/** Opens the window: false when the browser blocked it. */
export function openPaneWindow(target: SplitTarget, at: ScreenPoint | null = null): boolean {
  const opened = window.open("", "_blank", paneWindowFeatures(window, at));
  if (!opened) return false;
  try {
    opened.sessionStorage.clear();
  } catch {
    /* a browser that keeps the blank window's storage apart has nothing of this window's to clear */
  }
  opened.opener = null;
  opened.location.replace(paneWindowUrl(target, window.location));
  return true;
}
