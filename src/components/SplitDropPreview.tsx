import type { CSSProperties } from "react";
import { useT } from "../lib/i18n.ts";
import type { DropZone, SplitRect } from "../lib/split.ts";
import "./SplitDropPreview.css";

/** a rectangle of the area, drawn in from its edges as far as the slot outlines are */
const place = (rect: SplitRect): CSSProperties => ({
  left: `calc(${rect.x * 100}% + var(--space-1))`, top: `calc(${rect.y * 100}% + var(--space-1))`,
  width: `calc(${rect.w * 100}% - 2 * var(--space-1))`, height: `calc(${rect.h * 100}% - 2 * var(--space-1))`,
});

/**
 * A guide over the pane area; it never takes a drag, focus or space from the terminals. Each slot
 * is outlined, and one highlight moves to the place the dropped pane would take.
 */
export function SplitDropPreview({ visible, zone, slots, target }: { visible: boolean; zone: DropZone | null; slots: SplitRect[]; target: SplitRect | null }) {
  const t = useT();
  const label = !zone ? null : zone.edge === "left" ? t("Drop on the left") : zone.edge === "right" ? t("Drop on the right")
    : zone.edge === "top" ? t("Drop above") : zone.edge === "bottom" ? t("Drop below") : t("Open here");
  return <div className={`split-drop${visible ? " is-visible" : ""}`} data-edge={zone ? zone.edge ?? "middle" : undefined} aria-hidden="true">
    <div className="split-drop-track">
      {slots.map((rect) => <div key={`${rect.x}:${rect.y}`} className="split-drop-slot" style={place(rect)} />)}
      <div className="split-drop-target" style={target ? place(target) : undefined}>
        {label && <span className="split-drop-label">{label}</span>}
      </div>
    </div>
  </div>;
}
