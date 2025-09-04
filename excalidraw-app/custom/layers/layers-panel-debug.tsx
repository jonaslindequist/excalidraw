import { ExcalidrawElement } from "@excalidraw/element/src/types";

type OrderMaps = {
  pos: Map<string, number>; // array position (render pass order)
  fidx: Map<string, string>; // element.index as string (fractional index)
  byId: Map<string, ExcalidrawElement>;
};

export function buildOrderMaps(all: readonly ExcalidrawElement[]): OrderMaps {
  const pos = new Map<string, number>();
  const fidx = new Map<string, string>();
  const byId = new Map<string, ExcalidrawElement>();
  all.forEach((e, i) => {
    pos.set(e.id, i);
    fidx.set(e.id, String((e as any).index ?? ""));
    byId.set(e.id, e);
  });
  return { pos, fidx, byId };
}

/** follow frameId chain to see if an element is a descendant of `rootFrameId` */
function isDescendantOfFrame(
  el: ExcalidrawElement,
  rootFrameId: string,
  byId: Map<string, ExcalidrawElement>,
) {
  let cur: ExcalidrawElement | undefined = el;
  while (cur?.frameId) {
    if (cur.frameId === rootFrameId) return true;
    cur = byId.get(cur.frameId);
  }
  return false;
}

/**
 * Check the invariant for a frame:
 *   all descendants form a contiguous block that ends exactly at (frameIndex - 1).
 */
export function analyzeFrameSubtree(
  all: readonly ExcalidrawElement[],
  frameId: string,
) {
  const { byId } = buildOrderMaps(all);
  const frameIndex = all.findIndex((e) => e.id === frameId);
  if (frameIndex < 0) return { ok: false, msg: "frame not found" };

  const descendantIndices: number[] = [];
  all.forEach((e, i) => {
    if (i !== frameIndex && isDescendantOfFrame(e, frameId, byId)) {
      descendantIndices.push(i);
    }
  });
  if (!descendantIndices.length) {
    return { ok: true, msg: "no descendants", frameIndex };
  }
  const blockStart = Math.min(...descendantIndices);
  const blockEnd = Math.max(...descendantIndices);
  const shouldEnd = frameIndex - 1;

  const gaps: number[] = [];
  for (let i = blockStart; i <= blockEnd; i++) {
    if (!descendantIndices.includes(i)) gaps.push(i);
  }

  const ok = gaps.length === 0 && blockEnd === shouldEnd;
  const msg = ok
    ? "OK"
    : `expected contiguous descendants ending at ${shouldEnd}, got [${blockStart}..${blockEnd}] gaps=${gaps.join(
        ",",
      )}`;

  return {
    ok,
    msg,
    frameIndex,
    blockStart,
    blockEnd,
    shouldEnd,
    descendantIndices,
    gaps,
  };
}

/** Console dump (quick glance) */
export function logZOrder(
  all: readonly ExcalidrawElement[],
  label = "z-order",
) {
  const rows = all.map((e, i) => ({
    i,
    id: e.id.slice(0, 6),
    type: e.type,
    name:
      e.type === "frame"
        ? (e as any).name || (e as any).customData?.title || ""
        : "",
    frame: e.frameId ? e.frameId.slice(0, 6) : "",
    idx: String((e as any).index ?? ""),
  }));
  // eslint-disable-next-line no-console
  console.groupCollapsed(`[Z] ${label} (n=${rows.length})`);
  // eslint-disable-next-line no-console
  console.table(rows);
  // eslint-disable-next-line no-console
  console.log(
    rows
      .map(
        (r) =>
          `${String(r.i).padStart(3)} ${r.type}${r.name ? ":" + r.name : ""}${
            r.frame ? " [in " + r.frame + "]" : ""
          } idx=${r.idx}`,
      )
      .join("\n"),
  );
  // eslint-disable-next-line no-console
  console.groupEnd();
}

/** tiny badge component (inline, no CSS changes required) */
export const OrderBadge: React.FC<{
  pos?: number;
  idx?: string;
  warn?: boolean;
}> = ({ pos, idx, warn }) => (
  <span
    style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 10,
      padding: "1px 4px",
      borderRadius: 4,
      border: `1px solid ${warn ? "#f59e0b" : "var(--layer-border,#ccc)"}`,
      background: warn
        ? "rgba(245,158,11,0.12)"
        : "var(--layer-bg,transparent)",
      marginRight: 6,
      opacity: 0.9,
    }}
    title={`arrayPos=${pos ?? ""}  index=${idx ?? ""}`}
  >
    #{pos ?? "-"} {idx ? `| ${idx}` : ""}
  </span>
);
