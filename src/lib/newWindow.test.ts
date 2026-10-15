import { describe, expect, it } from "bun:test";
import { outsideWindow, paneWindowFeatures, paneWindowUrl } from "./newWindow.ts";

const frame = { screenX: 100, screenY: 50, outerWidth: 1600, outerHeight: 900 };

describe("a pane in a new window", () => {
  it("tells a point outside the window from one inside it", () => {
    expect(outsideWindow({ x: 99, y: 400 }, frame)).toBe(true);
    expect(outsideWindow({ x: 1700, y: 400 }, frame)).toBe(true);
    expect(outsideWindow({ x: 800, y: 950 }, frame)).toBe(true);
    expect(outsideWindow({ x: 100, y: 50 }, frame)).toBe(false);
    expect(outsideWindow({ x: 1699, y: 949 }, frame)).toBe(false);
    // a drag end reported with no position is not a tear-off
    expect(outsideWindow({ x: 0, y: 0 }, frame)).toBe(false);
  });

  it("opens the app on the pane alone, at this window's path", () => {
    expect(paneWindowUrl({ machineId: "local", paneId: "w1:p2" }, { origin: "http://127.0.0.1:7317", pathname: "/" }))
      .toBe("http://127.0.0.1:7317/?pane=w1%3Ap2");
    expect(paneWindowUrl({ machineId: "macbook", paneId: "w3:p1" }, { origin: "https://pc.example", pathname: "/app/" }))
      .toBe("https://pc.example/app/?machine=macbook&pane=w3%3Ap1");
  });

  it("opens a window of its own, under the pointer or beside this one", () => {
    expect(paneWindowFeatures(frame, { x: 3000, y: 200 })).toBe("popup,width=960,height=900,left=2840,top=176");
    expect(paneWindowFeatures(frame, null)).toBe("popup,width=960,height=900,left=740,top=50");
    expect(paneWindowFeatures({ ...frame, outerWidth: 800, outerHeight: 400 }, null)).toContain("width=640,height=480");
  });
});
