import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { createPresence, tabKey, type Arrival, type Presence } from "./windowPresence.ts";

/** One browser's channels: every window's BroadcastChannel of a name hears the others, never itself. */
class Bus {
  channels = new Set<FakeChannel>();
}
let bus = new Bus();
class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) { bus.channels.add(this); }
  postMessage(data: unknown): void {
    for (const channel of bus.channels) if (channel !== this && channel.name === this.name) channel.onmessage?.({ data } as MessageEvent);
  }
  close(): void { bus.channels.delete(this); }
}

interface FakeWindow { name: string; opened: Array<{ name: string; reached: unknown }>; closed: number }

/** Runs `make` as the app in a window of its own name; `reach` is what window.open("", name) gives. */
function inWindow<T>(win: FakeWindow, reach: (name: string) => unknown, make: () => T): T {
  const previous = globalThis.window;
  const self: Record<string, unknown> = {
    get name() { return win.name; },
    set name(value: string) { win.name = value; },
    addEventListener() {},
    removeEventListener() {},
    open(_url: string, name: string) {
      const reached = reach(name);
      win.opened.push({ name, reached });
      return reached;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: self });
  try { return make(); } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previous });
  }
}

describe("the app's windows", () => {
  const original = globalThis.BroadcastChannel;
  beforeEach(() => {
    bus = new Bus();
    (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;
  });
  afterEach(() => {
    (globalThis as { BroadcastChannel: unknown }).BroadcastChannel = original;
  });

  const open = (label: string, arrivals: Arrival[], reach: (name: string) => unknown = () => null): { presence: Presence; win: FakeWindow } => {
    const win: FakeWindow = { name: "", opened: [], closed: 0 };
    const made = inWindow(win, reach, () => createPresence((arrival) => arrivals.push(arrival)));
    expect(win.name.startsWith("herdr-web-ui:")).toBe(true);
    void label;
    // each call runs as this window: its own `window`, as in a browser
    const run = <T,>(call: () => T): T => inWindow(win, reach, call);
    const presence: Presence = {
      name: made.name,
      announce: (tabs) => run(() => made.announce(tabs)),
      holder: (tab) => made.holder(tab),
      neighbour: (direction) => made.neighbour(direction),
      bringForward: (to, arrival) => run(() => made.bringForward(to, arrival)),
      dispose: () => run(() => made.dispose()),
    };
    return { presence, win };
  };

  it("finds the window that draws a tab, and the windows on either side in the order they started", () => {
    // the windows start a moment apart, which sets their order
    setSystemTime(new Date(1_000));
    const a = open("a", []);
    setSystemTime(new Date(2_000));
    const b = open("b", []);
    setSystemTime(new Date(3_000));
    const c = open("c", []);
    setSystemTime();
    b.presence.announce([tabKey("local", "w1:t1")]);
    expect(a.presence.holder(tabKey("local", "w1:t1"))).toBe(b.win.name);
    expect(c.presence.holder(tabKey("local", "w1:t1"))).toBe(b.win.name);
    expect(a.presence.holder(tabKey("macbook", "w1:t1"))).toBeNull();
    expect(a.presence.neighbour(1)).toBe(b.win.name);
    expect(a.presence.neighbour(-1)).toBe(c.win.name);
    expect(c.presence.neighbour(1)).toBe(a.win.name);
    b.presence.dispose();
    expect(a.presence.holder(tabKey("local", "w1:t1"))).toBeNull();
    expect(a.presence.neighbour(1)).toBe(c.win.name);
  });

  it("never closes a window under that name that is not a blank one", () => {
    const b = open("b", []);
    let closed = 0;
    const a = open("a", [], () => ({ get location(): never { throw new Error("cross-origin"); }, close: () => { closed += 1; } }));
    expect(a.presence.bringForward(b.win.name, { edge: "first" })).toBe(false);
    expect(closed).toBe(0);
  });

  it("has no neighbour alone", () => {
    const a = open("a", []);
    expect(a.presence.neighbour(1)).toBeNull();
  });

  it("brings a reachable window forward and tells it what to show", () => {
    const arrivals: Arrival[] = [];
    const b = open("b", arrivals);
    const a = open("a", [], () => ({ __herdrWebUiWindow: true }));
    const arrival: Arrival = { tab: tabKey("local", "w2:t1"), target: { machineId: "local", paneId: "w2:p1" } };
    expect(a.presence.bringForward(b.win.name, arrival)).toBe(true);
    expect(a.win.opened.map((item) => item.name)).toEqual([b.win.name]);
    expect(arrivals).toEqual([arrival]);
  });

  it("closes the blank window a name it cannot reach opens, and forgets that window", () => {
    const b = open("b", []);
    b.presence.announce([tabKey("local", "w2:t1")]);
    let closed = 0;
    const a = open("a", [], () => ({ location: { href: "about:blank" }, close: () => { closed += 1; } }));
    expect(a.presence.holder(tabKey("local", "w2:t1"))).toBe(b.win.name);
    expect(a.presence.bringForward(b.win.name, { edge: "first" })).toBe(false);
    expect(closed).toBe(1);
    expect(a.presence.holder(tabKey("local", "w2:t1"))).toBeNull();
    // out of reach for good: what it says later does not bring it back
    b.presence.announce([tabKey("local", "w2:t1"), tabKey("local", "w3:t1")]);
    expect(a.presence.holder(tabKey("local", "w2:t1"))).toBeNull();
    expect(a.presence.neighbour(1)).toBeNull();
    // a blocked open gives nothing to close
    const c = open("c", [], () => null);
    expect(c.presence.bringForward(b.win.name, { edge: "last" })).toBe(false);
  });
});
