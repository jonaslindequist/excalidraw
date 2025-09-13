import {
  getElementAbsoluteCoords,
  newFrameElement,
  newLinearElement,
  newTextElement,
} from "@excalidraw/element";

import type { LocalPoint } from "@excalidraw/math";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  FractionalIndex,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { alignTopLeftFromAnchor } from "./anchor";

import type { Plan, SelectorT } from "./schemas";

/* ------------------------------------------------------------------ */
/* Facts store interface (trivial in-memory default)                   */
/* ------------------------------------------------------------------ */

export type FactsStore = {
  ensure(kind: string, attrs: Record<string, any>, idHint?: string): string; // returns factId
  // optional: lookup, etc.
};

export function createInMemoryFactsStore(): FactsStore {
  const byId = new Map<string, { kind: string; attrs: any }>();
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$|/g, "");
  return {
    ensure(kind, attrs, idHint) {
      // dumb deterministic-ish id
      const base = idHint ? slug(idHint) : slug(`${kind}-${attrs.name ?? ""}`);
      let id =
        base || `${slug(kind)}-${Math.random().toString(36).slice(2, 8)}`;
      let i = 1;
      while (byId.has(id)) {
        id = `${base}-${i++}`;
      }
      byId.set(id, { kind, attrs });
      return id;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Selector resolution                                                */
/* ------------------------------------------------------------------ */

function resolveSelector(
  selector: SelectorT,
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  if ("byId" in selector) {
    const el = elements.find((e) => e.id === selector.byId);
    return el ? [el] : [];
  }
  if ("byTitle" in selector) {
    return elements.filter(
      (e) => (e as any).customData?.title === selector.byTitle,
    );
  }
  if ("byTitleLike" in selector) {
    const re = new RegExp(selector.byTitleLike, "i");
    return elements.filter((e) => re.test((e as any).customData?.title || ""));
  }
  if ("byFact" in selector) {
    const { kind, attrs } = selector.byFact;
    return elements.filter((e) => {
      const cd = (e as any).customData ?? {};
      if (!cd.factId) {
        return false;
      }
      // If you persist facts somewhere richer, adapt this:
      return cd.factKind === kind
        ? !attrs ||
            Object.entries(attrs).every(([k, v]) => cd.factAttrs?.[k] === v)
        : false;
    });
  }
  // inFrame / filter
  if ("inFrame" in selector) {
    // Note: 'inFrame' is itself a Selector (client side). Here we only support byId & byTitle.
    let frames: ExcalidrawElement[] = [];
    const f = selector.inFrame as any;
    if (typeof f?.byId === "string") {
      const el = elements.find((e) => e.id === f.byId);
      if (el) {
        frames = [el];
      }
    } else if (typeof f?.byTitle === "string") {
      frames = elements.filter(
        (e) => (e as any).customData?.title === f.byTitle && e.type === "frame",
      );
    }
    const frameIds = new Set(frames.map((e) => e.id));
    const typeFilter = selector.filter?.type;
    return elements.filter(
      (e) =>
        frameIds.has(e.frameId || "") && (!typeFilter || e.type === typeFilter),
    );
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function getFrameRectByIdFactory(elements: () => readonly ExcalidrawElement[]) {
  return (id: string) => {
    const f = elements().find((e) => e.id === id && e.type === "frame") as
      | ExcalidrawFrameElement
      | undefined;
    if (!f) {
      return null;
    }
    return { x: f.x, y: f.y, w: f.width, h: f.height };
  };
}

/* Create basic shapes — swap to your actual creators if names differ */
function makeRect(x: number, y: number, w: number, h: number) {
  // If you have newRectangleElement, prefer it:
  // return newRectangleElement({ x, y, width: w, height: h });
  const el: any = {
    type: "rectangle",
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    id: Math.random().toString(36).slice(2) as string,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: 0,
    isDeleted: false,
    groupIds: [],
    boundElements: null,
    opacity: 100,
    strokeColor: "#1e293b",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    frameId: null,
    roundness: { type: 3, value: 8 }, // rounded rect look
  };
  return el as ExcalidrawElement;
}

function makeEllipse(x: number, y: number, w: number, h: number) {
  const el = makeRect(x, y, w, h);
  (el as any).type = "ellipse";
  (el as any).roundness = null;
  return el;
}

function makeDiamond(x: number, y: number, w: number, h: number) {
  const el = makeRect(x, y, w, h);
  (el as any).type = "diamond";
  (el as any).roundness = null;
  return el;
}

function makeText(x: number, y: number, text: string) {
  return newTextElement({
    x,
    y,
    text,
    // you can add font options, alignment etc here if desired
  }) as ExcalidrawElement;
}

// helper to create branded local points
const lp = (x: number, y: number) => [x, y] as LocalPoint;

export function makeArrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  label?: string,
) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const dx = x2 - x;
  const dy = y2 - y;

  const arrow = newLinearElement({
    type: "arrow",
    x,
    y,
    // points are *local* to (x, y)
    points: [lp(0, 0), lp(dx, dy)],
  }) as ExcalidrawElement;

  // (Optional) stash a label in customData; or bind a real text element (below)
  if (label) {
    (arrow as any).customData = {
      ...(arrow as any).customData,
      label,
    };
  }

  return arrow;
}

function centerOf(el: ExcalidrawElement, all: Map<string, ExcalidrawElement>) {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(el, all);
  return { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

/* ------------------------------------------------------------------ */
/* Main executor                                                       */
/* ------------------------------------------------------------------ */

export async function executePlan(
  api: ExcalidrawImperativeAPI,
  plan: Plan,
  facts: FactsStore = createInMemoryFactsStore(),
  eventTarget?: EventTarget, // pass your overlay root ref here to dispatch exca:scene
) {
  const tempToReal = new Map<string, string>();

  const elementsFn = () => api.getSceneElementsIncludingDeleted();
  const getFrameRectById = getFrameRectByIdFactory(elementsFn);

  const nextIndex = (afterIdx?: FractionalIndex): FractionalIndex =>
    `${afterIdx ?? "a"}a` as FractionalIndex;

  // wherever you build the working array, make sure it's mutable & typed
  let elements: OrderedExcalidrawElement[] = [
    ...api.getSceneElementsIncludingDeleted(),
  ] as OrderedExcalidrawElement[];

  const upsert = (
    created: ExcalidrawElement,
    opts?: {
      frame?: string | null;
      title?: string;
      factId?: string;
      factMeta?: { kind?: string; attrs?: any };
    },
  ) => {
    // decorate customData
    const cd0 = (created as any).customData ?? {};
    (created as any).customData = {
      ...cd0,
      ...(opts?.title ? { title: opts.title } : null),
      ...(opts?.factId
        ? {
            factId: opts.factId,
            factKind: opts.factMeta?.kind,
            factAttrs: opts.factMeta?.attrs,
          }
        : null),
      ...(created.type === "frame"
        ? {
            expandable: true,
            collapsed: false,
            originalSize: { w: created.width, h: created.height },
          }
        : null),
    };

    if (opts?.frame) {
      (created as any).frameId = opts.frame;
    }

    // assign a valid fractional index so it satisfies OrderedExcalidrawElement
    const afterIdx = elements.length
      ? elements[elements.length - 1].index
      : undefined;
    const ord: OrderedExcalidrawElement = {
      ...(created as any),
      index: nextIndex(afterIdx),
    };

    elements.push(ord);
  };

  const byId = () => new Map(elements.map((e) => [e.id, e] as const));

  for (const op of plan.plan) {
    switch (op.op) {
      case "create_frame": {
        const { w, h } = op.size;
        const { x, y } = alignTopLeftFromAnchor(
          op.anchor,
          w,
          h,
          api,
          tempToReal,
          getFrameRectById,
        );
        const frame = newFrameElement({
          x,
          y,
          width: w,
          height: h,
          name: "", // we render our own header/title; keep canvas name empty (or set if you prefer)
        }) as ExcalidrawFrameElement;

        // store title in customData.title
        upsert(frame, { title: op.title });
        if (op.tempId) {
          tempToReal.set(`@${op.tempId}`, frame.id);
        }
        break;
      }

      case "create_element": {
        const type = op.type;
        const w = op.size?.w ?? 160;
        const h = op.size?.h ?? (type === "text" ? 0 : 80);

        // resolve frame target (can be selector, real id, or @tempId)
        let frameId: string | null = null;
        if (typeof op.frame === "string") {
          if (op.frame.startsWith("@")) {
            frameId = tempToReal.get(op.frame) ?? null;
          } else {
            frameId = op.frame || null;
          }
        } else if (op.frame) {
          const matches = resolveSelector(op.frame as any, elements);
          const first = matches.find((e) => e.type === "frame");
          frameId = first?.id ?? null;
        }

        const { x, y } = alignTopLeftFromAnchor(
          op.anchor,
          w,
          h,
          api,
          tempToReal,
          getFrameRectById,
        );

        let el: ExcalidrawElement;

        if (type === "text") {
          el = makeText(x, y, op.text ?? op.label ?? "");
        } else if (type === "rectangle") {
          el = makeRect(x, y, w, h);
        } else if (type === "ellipse") {
          el = makeEllipse(x, y, w, h);
        } else if (type === "diamond") {
          el = makeDiamond(x, y, w, h);
        } else if (type === "image") {
          // You can add your image pipeline here (placeholder as rect)
          el = makeRect(x, y, w, h);
          (el as any).customData = {
            ...(el as any).customData,
            isImagePlaceholder: true,
          };
        } else {
          // fallback
          el = makeRect(x, y, w, h);
        }

        // label vs text: for non-text, store label in customData.title
        const title =
          type === "text" ? undefined : op.label ?? op.text ?? undefined;

        // fact ensure (optional)
        let factId: string | undefined;
        let factMeta: { kind?: string; attrs?: any } | undefined;
        if (op.fact?.ensure) {
          factId = facts.ensure(op.fact.kind, op.fact.attrs, op.fact.idHint);
          factMeta = { kind: op.fact.kind, attrs: op.fact.attrs };
        }

        upsert(el, {
          frame: frameId,
          title,
          factId,
          factMeta,
        });

        if (op.tempId) {
          tempToReal.set(`@${op.tempId}`, el.id);
        }
        break;
      }

      case "connect": {
        const all = elements;
        const left = resolveTarget(op.from, all)[0];
        const right = resolveTarget(op.to, all)[0];
        if (!left || !right) {
          break;
        }

        const map = byId();
        const { cx: x1, cy: y1 } = centerOf(left, map);
        const { cx: x2, cy: y2 } = centerOf(right, map);

        const arrow = makeArrow(x1, y1, x2, y2, op.style?.label);
        if (op.style?.dashed) {
          (arrow as any).strokeStyle = "dashed";
        }
        if (op.style?.thickness) {
          (arrow as any).strokeWidth = op.style.thickness;
        }

        // ensure it’s ordered and (optionally) framed
        upsert(arrow, { frame: commonFrame(left, right) });
        break;
      }

      case "update": {
        const targets = resolveTarget(op.target, elements);
        for (const t of targets) {
          const cd0 = (t as any).customData ?? {};
          const next: any = { ...t };
          if (op.set.title !== undefined) {
            next.customData = { ...cd0, title: op.set.title };
          }
          if (op.set.size) {
            next.width = op.set.size.w;
            next.height = op.set.size.h;
          }
          if (op.set.collapsed !== undefined && t.type === "frame") {
            const prevCD: any = (t as any).customData ?? {};
            const originalSize = prevCD.originalSize ?? {
              w: t.width,
              h: t.height,
            };
            const desiredCollapsed = !!op.set.collapsed;

            next.customData = {
              ...prevCD,
              expandable: true,
              collapsed: desiredCollapsed,
              originalSize: desiredCollapsed
                ? { w: t.width, h: t.height }
                : originalSize,
            };
            if (desiredCollapsed) {
              // match your collapsed dims (you can import constants if you prefer)
              const COLLAPSED_W = 220;
              const COLLAPSED_H = 32;
              next.width = COLLAPSED_W;
              next.height = COLLAPSED_H;
            } else {
              next.width = originalSize.w;
              next.height = originalSize.h;
            }
          }
          // replace in array
          elements = elements.map((e) => (e.id === t.id ? next : e));
        }
        break;
      }

      case "ensure_fact": {
        const id = facts.ensure(op.kind, op.attrs, op.tempId);
        if (op.tempId) {
          tempToReal.set(`@${op.tempId}`, id);
        }
        break;
      }

      case "link_fact": {
        const targets = resolveTarget(op.target, elements);
        let factId: string | undefined;
        let meta: { kind?: string; attrs?: any } | undefined;

        if (typeof op.fact === "string") {
          if (op.fact.startsWith("@")) {
            // temp fact id (from ensure_fact)
            factId = tempToReal.get(op.fact) ?? undefined;
          } else {
            factId = op.fact;
          }
        } else if ("kind" in op.fact) {
          factId = facts.ensure(op.fact.kind, op.fact.match ?? {}, undefined);
          meta = { kind: op.fact.kind, attrs: op.fact.match ?? {} };
        }

        if (factId) {
          elements = elements.map((e) => {
            if (!targets.find((t) => t.id === e.id)) {
              return e;
            }
            const cd0 = (e as any).customData ?? {};
            return {
              ...e,
              customData: {
                ...cd0,
                factId,
                ...(meta
                  ? { factKind: meta.kind, factAttrs: meta.attrs }
                  : null),
              },
            } as any;
          });
        }
        break;
      }
    } // switch
  } // for

  // commit once
  api.updateScene({ elements });

  // nudge overlays
  eventTarget?.dispatchEvent(new CustomEvent("exca:scene"));
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function resolveTarget(
  target: SelectorT | string,
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  if (typeof target === "string") {
    if (target.startsWith("@")) {
      // not resolvable here (handled earlier via tempToReal for anchors)
      return [];
    }
    const el = elements.find((e) => e.id === target);
    return el ? [el] : [];
  }
  return resolveSelector(target, elements);
}

function commonFrame(
  a: ExcalidrawElement,
  b: ExcalidrawElement,
): string | null {
  return a.frameId && a.frameId === b.frameId ? a.frameId : null;
}
