import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { AnchorT } from "./schemas";

// 1) Give alignTo a precise return type
type XY = readonly [number, number];

function alignTo(
  ref: { x: number; y: number; w: number; h: number },
  align?:
    | "center"
    | "top-left"
    | "top-center"
    | "top-right"
    | "left-center"
    | "right-center"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right",
): XY {
  const { x, y, w, h } = ref;
  switch (align) {
    case "top-left":
      return [x, y];
    case "top-center":
      return [x + w / 2, y];
    case "top-right":
      return [x + w, y];
    case "left-center":
      return [x, y + h / 2];
    case "right-center":
      return [x + w, y + h / 2];
    case "bottom-left":
      return [x, y + h];
    case "bottom-center":
      return [x + w / 2, y + h];
    case "bottom-right":
      return [x + w, y + h];
    case "center":
    default:
      return [x + w / 2, y + h / 2];
  }
}

// 2) Spell out the tuple return type on anchorToXY
export function anchorToXY(
  api: ExcalidrawImperativeAPI,
  a: AnchorT,
  tempToReal: Map<string, string>,
  getFrameRectById: (
    id: string,
  ) => { x: number; y: number; w: number; h: number } | null,
): XY {
  const app = api.getAppState();
  let refRect: { x: number; y: number; w: number; h: number } | null = null;

  if (a.ref === "viewport:center") {
    const { width, height, offsetLeft, offsetTop, zoom } = app;
    const cx = (width / 2 - offsetLeft) / zoom.value;
    const cy = (height / 2 - offsetTop) / zoom.value;
    refRect = { x: cx - 1, y: cy - 1, w: 2, h: 2 };
  } else if (a.ref === "selection:center") {
    const els = api.getSceneElements();
    const sel = els.filter((e) => app.selectedElementIds[e.id]);
    if (sel.length) {
      const x1 = Math.min(...sel.map((e) => e.x));
      const y1 = Math.min(...sel.map((e) => e.y));
      const x2 = Math.max(...sel.map((e) => e.x + e.width));
      const y2 = Math.max(...sel.map((e) => e.y + e.height));
      refRect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  } else if (a.ref.startsWith("frame:")) {
    const id = a.ref.slice("frame:".length);
    const rect = getFrameRectById(id);
    if (rect) refRect = rect;
  } else if (a.ref.startsWith("@")) {
    const real = tempToReal.get(a.ref);
    if (real) {
      const el = api
        .getSceneElementsIncludingDeleted()
        .find((e) => e.id === real);
      if (el) refRect = { x: el.x, y: el.y, w: el.width, h: el.height };
    }
  }

  if (!refRect) {
    const { width, height, offsetLeft, offsetTop, zoom } = app;
    const cx = (width / 2 - offsetLeft) / zoom.value;
    const cy = (height / 2 - offsetTop) / zoom.value;
    refRect = { x: cx - 1, y: cy - 1, w: 2, h: 2 };
  }

  const [ax, ay] = alignTo(refRect, a.align ?? "center");
  const [dx, dy] = a.offset ?? [0, 0];
  return [ax + dx, ay + dy] as const;
}

// 3) Use tuple destructuring in alignTopLeftFromAnchor
export function alignTopLeftFromAnchor(
  anchor: AnchorT,
  w: number,
  h: number,
  api: ExcalidrawImperativeAPI,
  tempToReal: Map<string, string>,
  getFrameRectById: (
    id: string,
  ) => { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number } {
  const [ax, ay] = anchorToXY(api, anchor, tempToReal, getFrameRectById);
  const align = anchor.align ?? "center";

  switch (align) {
    case "center":
      return { x: ax - w / 2, y: ay - h / 2 };
    case "top-left":
      return { x: ax, y: ay };
    case "top-center":
      return { x: ax - w / 2, y: ay };
    case "top-right":
      return { x: ax - w, y: ay };
    case "left-center":
      return { x: ax, y: ay - h / 2 };
    case "right-center":
      return { x: ax - w, y: ay - h / 2 };
    case "bottom-left":
      return { x: ax, y: ay - h };
    case "bottom-center":
      return { x: ax - w / 2, y: ay - h };
    case "bottom-right":
      return { x: ax - w, y: ay - h };
  }
}
