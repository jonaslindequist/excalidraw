import {
  newFrameElement /* <- from @excalidraw/element */,
} from "@excalidraw/element";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { toggleFrameCollapsed } from "../expandable-frames/imperativeOverlay";
import { anchorToXY } from "./anchor";
import { Plan } from "./schemas";
import { resolveSelector } from "./selectors";
import { FactsStore } from "./store";

/** Get a frame client rect by id (in scene coords) */
function getFrameRectById(api: ExcalidrawImperativeAPI, id: string) {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === id);
  if (!el) return null;
  return { x: el.x, y: el.y, w: el.width, h: el.height };
}

/** Create a simple text element (fallback) */
function createTextElement(x: number, y: number, text: string) {
  // Minimal text object (Excalidraw will size/normalize at runtime)
  const id = "el_" + Math.random().toString(36).slice(2, 10);
  return {
    id,
    type: "text",
    x,
    y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#000000",
    backgroundColor: "transparent",
    fillStyle: "hachure",
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    text,
    fontSize: 18,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
    baseline: 18,
    containerId: null,
    customData: undefined,
  } as any;
}

/** Create a generic rectangle-like shape */
function createRectElement(
  x: number,
  y: number,
  w: number,
  h: number,
  label?: string,
) {
  const id = "el_" + Math.random().toString(36).slice(2, 10);
  return {
    id,
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#1f2937",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    customData: label ? { title: label } : undefined,
  } as any;
}

/** Simple arrow (no bindings for brevity; you can add start/end bindings later) */
function createArrowElement(
  from: { x: number; y: number },
  to: { x: number; y: number },
  label?: string,
) {
  const id = "el_" + Math.random().toString(36).slice(2, 10);
  return {
    id,
    type: "arrow",
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
    points: [
      [0, 0],
      [to.x - from.x, to.y - from.y],
    ],
    angle: 0,
    strokeColor: "#111827",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 0,
    opacity: 100,
    roundness: { type: 2 },
    groupIds: [],
    frameId: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    customData: label ? { title: label } : undefined,
    startBinding: null,
    endBinding: null,
    startArrowhead: "arrow",
    endArrowhead: "arrow",
  } as any;
}

/** Apply a validated plan to the scene. */
export async function applyPlan(api: ExcalidrawImperativeAPI, plan: Plan) {
  const tempToReal = new Map<string, string>();
  let elements = api.getSceneElementsIncludingDeleted();

  const resolveFrameId = (idOrTemp?: string | null) => {
    if (!idOrTemp) return null;
    if (idOrTemp.startsWith?.("@")) return tempToReal.get(idOrTemp) || null;
    return idOrTemp;
  };

  const push = (el: any) => {
    elements = [...elements, el];
  };

  const flush = () => api.updateScene({ elements });

  // helpers
  const frameRectById = (id: string) => getFrameRectById(api, id);

  for (const op of plan.plan) {
    if (op.op === "create_frame") {
      const [cx, cy] = anchorToXY(api, op.anchor, tempToReal, (id) =>
        frameRectById(id),
      );
      const x = Math.round(cx - op.size.w / 2);
      const y = Math.round(cy - op.size.h / 2);

      const frame = newFrameElement({
        x,
        y,
        width: op.size.w,
        height: op.size.h,
        name: "", // keep empty; your overlay reads customData.title
        backgroundColor: "#fffbe6",
      }) as any;

      frame.customData = {
        ...(op.customData || {}),
        expandable: op.customData?.expandable ?? true,
        collapsed: false,
        originalSize: { w: op.size.w, h: op.size.h },
        title: op.title,
      };

      push(frame);
      flush();

      tempToReal.set("@" + op.tempId, frame.id);
    } else if (op.op === "create_element") {
      const [cx, cy] = anchorToXY(api, op.anchor, tempToReal, (id) =>
        frameRectById(id),
      );
      let newEl: any;

      if (op.type === "text") {
        newEl = createTextElement(
          Math.round(cx),
          Math.round(cy),
          op.text || (op.label ?? "Text"),
        );
      } else {
        const w = op.size?.w ?? 220;
        const h = op.size?.h ?? 120;
        newEl = createRectElement(
          Math.round(cx - w / 2),
          Math.round(cy - h / 2),
          w,
          h,
          op.label,
        );
        // TODO: add ellipse/diamond/image variants as needed
        if (op.type !== "rectangle") newEl.type = op.type;
      }

      // assign frame (either selector or @tempId or plain id)
      let targetFrameId: string | null = null;
      if (typeof op.frame === "string") {
        targetFrameId = resolveFrameId(op.frame);
      } else if (op.frame && typeof op.frame === "object") {
        const ids = resolveSelector(api, op.frame as any, tempToReal);
        targetFrameId = ids[0] ?? null;
      }
      newEl.frameId = targetFrameId ?? null;

      // ensure fact (store + link)
      if (op.fact?.ensure) {
        const fact = FactsStore.ensure(
          op.fact.kind,
          op.fact.attrs,
          op.fact.idHint,
        );
        newEl.customData = { ...(newEl.customData || {}), factId: fact.id };
      }

      push(newEl);
      flush();

      if (op.tempId) tempToReal.set("@" + op.tempId, newEl.id);
    } else if (op.op === "connect") {
      const fromIds = resolveSelector(api, op.from as any, tempToReal);
      const toIds = resolveSelector(api, op.to as any, tempToReal);
      const from = elements.find((e) => e.id === fromIds[0]);
      const to = elements.find((e) => e.id === toIds[0]);
      if (!from || !to) continue;

      const fx = from.x + from.width / 2;
      const fy = from.y + from.height / 2;
      const tx = to.x + to.width / 2;
      const ty = to.y + to.height / 2;

      const arr = createArrowElement(
        { x: fx, y: fy },
        { x: tx, y: ty },
        op.style?.label,
      );
      push(arr);
      flush();
    } else if (op.op === "update") {
      const ids = resolveSelector(api, op.target as any, tempToReal);
      if (!ids.length) continue;
      const idset = new Set(ids);

      elements = elements.map((el: any) => {
        if (!idset.has(el.id)) return el;
        const cd = el.customData ?? {};
        let next = el;

        if (op.set.size) {
          next = { ...next, width: op.set.size.w, height: op.set.size.h };
          // keep snapshot if you want to preserve expand/restore behaviour
          next = {
            ...next,
            customData: {
              ...cd,
              originalSize: { w: op.set.size.w, h: op.set.size.h },
            },
          };
        }

        if (typeof op.set.collapsed === "boolean" && el.type === "frame") {
          // drive using your helper to keep children hidden state correct
          toggleFrameCollapsed(api, el.id, { recursive: false });
          // refresh elements after helper changed the scene
          elements = api.getSceneElementsIncludingDeleted();
          return elements.find((e) => e.id === el.id) || el;
        }

        if (op.set.title !== undefined) {
          next = { ...next, customData: { ...cd, title: op.set.title } };
        }
        if (op.set.customData) {
          next = { ...next, customData: { ...cd, ...op.set.customData } };
        }
        return next;
      });

      flush();
    } else if (op.op === "ensure_fact") {
      const fact = FactsStore.ensure(op.kind, op.attrs);
      if (op.tempId) tempToReal.set("@" + op.tempId, fact.id);
    } else if (op.op === "link_fact") {
      const ids = resolveSelector(api, op.target as any, tempToReal);
      let factId: string | null = null;

      if (typeof op.fact === "string") {
        if (op.fact.startsWith("@")) {
          factId = tempToReal.get(op.fact) || null;
        } else {
          factId = op.fact;
        }
      } else if (typeof op.fact === "object") {
        const f = FactsStore.findByMatch(op.fact.kind, op.fact.match);
        factId = f?.id || null;
      }

      if (factId) {
        const set = new Set(ids);
        elements = elements.map((el: any) =>
          set.has(el.id)
            ? { ...el, customData: { ...(el.customData || {}), factId } }
            : el,
        );
        flush();
      }
    }
  }
}
