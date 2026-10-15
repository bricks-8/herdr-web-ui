import type { SplitTarget } from "./split.ts";

/**
 * The app's windows in one browser know each other (lib/newWindow.ts opens them), so a pane picked in
 * one that another already shows is shown there, and Option+Tab steps on into the next window's
 * slots. Each window is named (`window.name`) and says over a BroadcastChannel which tabs it draws.
 *
 * A window brings another forward by opening it by its name, which the browser allows from a key or
 * a click; asking it to raise itself does nothing (a window cannot take the focus on its own). A name
 * the browser cannot reach (a window opened by hand, outside this window's group) opens a blank window
 * instead: it is closed at once, that window is not tried again, and the pick opens the pane here.
 */

const CHANNEL = "herdr-web-ui:windows";
const NAME_PREFIX = "herdr-web-ui:";
/** when this window first started, kept across its reloads so it keeps its place in the step order */
const SINCE_KEY = "herdr-web-ui:window-since";
/** set on every app window, so a window reached by name is known to be one */
const MARK = "__herdrWebUiWindow";
/** how long a window asked whether it is there has to answer before it counts as gone */
const ANSWER_MS = 600;

/** a tab one window draws: its PC and herdr's tab id */
export function tabKey(machineId: string, tab: string): string {
  return `${machineId}\n${tab}`;
}

/** where a window brought forward puts its active slot */
export type Arrival = { tab: string; target: SplitTarget; view?: "chat" | "terminal" } | { edge: "first" | "last" };

interface Peer {
  tabs: Set<string>;
  /** when the window started: the order Option+Tab walks the windows in */
  since: number;
}

type Message =
  | { type: "hello"; from: string; since: number }
  | { type: "shown"; from: string; since: number; tabs: string[] }
  | { type: "bye"; from: string }
  | { type: "arrive"; from: string; to: string; arrival: Arrival };

export interface Presence {
  /** this window's name */
  readonly name: string;
  /** the tabs this window draws now: told to the others whenever they change */
  announce(tabs: string[]): void;
  /** another window drawing this tab, if any */
  holder(tab: string): string | null;
  /** the window before or after this one, in the order they started, if there is another */
  neighbour(direction: -1 | 1): string | null;
  /** brings `to` forward with `arrival` shown there: false when it could not be reached */
  bringForward(to: string, arrival: Arrival): boolean;
  dispose(): void;
}

const freshId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** This window's name, given once and kept across its reloads (the browser keeps `window.name`). */
export function windowName(): string {
  if (!window.name.startsWith(NAME_PREFIX)) window.name = `${NAME_PREFIX}${freshId()}`;
  return window.name;
}

/** A fresh name for a window about to open. */
export function newWindowName(): string {
  return `${NAME_PREFIX}${freshId()}`;
}

function startedAt(): number {
  try {
    const stored = Number(window.sessionStorage.getItem(SINCE_KEY));
    if (Number.isFinite(stored) && stored > 0) return stored;
    const now = Date.now();
    window.sessionStorage.setItem(SINCE_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

/** `onArrive` shows `arrival` in this window once another brought it forward. */
export function createPresence(onArrive: (arrival: Arrival) => void): Presence {
  const name = windowName();
  (window as unknown as Record<string, unknown>)[MARK] = true;
  const since = startedAt();
  const peers = new Map<string, Peer>();
  /** windows this one opened by name and reached none: a window opened by hand, out of reach for good */
  const unreachable = new Set<string>();
  /** the windows asked whether they are there, until they answer */
  let asked = new Set<string>();
  let answerTimer: ReturnType<typeof setTimeout> | null = null;
  let mine: string[] = [];
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  const post = (message: Message): void => { try { channel?.postMessage(message); } catch { /* closed */ } };
  const bye = (): void => post({ type: "bye", from: name });
  const seen = (from: string, peer: Peer): void => {
    asked.delete(from);
    if (!unreachable.has(from)) peers.set(from, peer);
  };
  /** asks every window whether it is there: one that crashed without a word is dropped */
  const hello = (): void => {
    asked = new Set(peers.keys());
    if (answerTimer !== null) clearTimeout(answerTimer);
    answerTimer = setTimeout(() => {
      answerTimer = null;
      for (const gone of asked) peers.delete(gone);
      asked = new Set();
    }, ANSWER_MS);
    post({ type: "hello", from: name, since });
  };
  const onShow = (): void => { if (typeof document === "undefined" || document.visibilityState !== "hidden") hello(); };

  if (channel) channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message !== "object" || message.from === name) return;
    switch (message.type) {
      case "hello":
        seen(message.from, { tabs: peers.get(message.from)?.tabs ?? new Set(), since: message.since });
        post({ type: "shown", from: name, since, tabs: mine });
        break;
      case "shown":
        seen(message.from, { tabs: new Set(message.tabs), since: message.since });
        break;
      case "bye":
        peers.delete(message.from);
        break;
      case "arrive":
        if (message.to === name) onArrive(message.arrival);
        break;
    }
  };
  window.addEventListener("pagehide", bye);
  window.addEventListener("pageshow", onShow);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onShow);
  hello();

  /** every window, this one included, in the order they started */
  const order = (): string[] => [...peers.entries(), [name, { tabs: new Set<string>(), since }] as const]
    .sort((a, b) => a[1].since - b[1].since || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);

  return {
    name,
    announce(tabs) {
      if (tabs.length === mine.length && tabs.every((tab, index) => tab === mine[index])) return;
      mine = tabs;
      post({ type: "shown", from: name, since, tabs });
    },
    holder(tab) {
      for (const [id, peer] of peers) if (peer.tabs.has(tab)) return id;
      return null;
    },
    neighbour(direction) {
      const all = order();
      if (all.length < 2) return null;
      return all[(all.indexOf(name) + direction + all.length) % all.length] ?? null;
    },
    bringForward(to, arrival) {
      let reached: Window | null = null;
      try {
        reached = window.open("", to);
      } catch {
        reached = null;
      }
      let ours = false;
      let blank = false;
      try {
        ours = reached !== null && (reached as unknown as Record<string, unknown>)[MARK] === true;
        blank = reached !== null && !ours && reached.location.href === "about:blank";
      } catch {
        // a window of another site under that name: not ours, and not ours to close
      }
      if (!ours) {
        // the blank window the browser made for a name it could not reach goes at once
        if (blank) { try { reached?.close(); } catch { /* already closed */ } }
        unreachable.add(to);
        peers.delete(to);
        return false;
      }
      post({ type: "arrive", from: name, to, arrival });
      return true;
    },
    dispose() {
      bye();
      if (answerTimer !== null) clearTimeout(answerTimer);
      window.removeEventListener("pagehide", bye);
      window.removeEventListener("pageshow", onShow);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onShow);
      channel?.close();
    },
  };
}
