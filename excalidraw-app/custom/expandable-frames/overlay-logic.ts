// overlay-logic.ts
import { updateElbowArrowPoints } from "@excalidraw/element";
import type {
  ExcalidrawElbowArrowElement,
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";
import { bumpVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type ById = Map<string, ExcalidrawElement>;

export const isFrame = (el: ExcalidrawElement): el is ExcalidrawFrameElement =>
  el.type === "frame";

function recomputeElbowArrow(
  arrow: ExcalidrawElbowArrowElement,
  elementsMap: NonDeletedSceneElementsMap,
  zoom: { value: number },
) {
  console.log("beofre: ", arrow);

  // Pass 1: pretend-drag so headings/snap logic match real UX
  const upd1 = updateElbowArrowPoints(
    arrow,
    elementsMap,
    { fixedSegments: [] }, // clear fixed segments so the router is free
    { isDragging: true }, // IMPORTANT: pass zoom when pretending to drag
  );

  console.log("after: ", upd1);
  const mid = { ...arrow, ...(upd1 ?? {}) };

  // Make the intermediate state visible to subsequent arrows in the same batch
  elementsMap.set(mid.id, mid as any);

  // Pass 2: finalize — call with *no updates* to trigger renormalization
  const upd2 = updateElbowArrowPoints(
    mid,
    elementsMap,
    { fixedSegments: [] }, // empty object → renormalization path
    { isDragging: false },
  );

  return bumpVersion({ ...mid, ...(upd2 ?? {}) });
}

export function forceRerouteElbowsForFrames(
  api: ExcalidrawImperativeAPI,
  changedFrameIds: string[],
) {
  const all = api.getSceneElementsIncludingDeleted();
  const live = all.filter((e) => !e.isDeleted);
  const map = new Map(live.map((e) => [e.id, e])) as any; // NonDeletedSceneElementsMap
  const changed = new Set(changedFrameIds);

  const updates = new Map<string, ExcalidrawElement>();

  for (const el of live) {
    if (el.type !== "arrow") continue;
    const arrow: any = el;

    // elbow-only
    const isElbow = arrow.elbowed === true;

    if (!isElbow) continue;

    // must be bound to a toggled frame
    const sb = arrow.startBinding?.elementId;
    const eb = arrow.endBinding?.elementId;

    console.log("reroute elbow", arrow.id, { sb, eb });

    // Pass 1: reset path, clear constraints → get a fresh route
    const minimalPoints = [
      arrow.points[0],
      arrow.points[arrow.points.length - 1],
    ];
    const upd1 = updateElbowArrowPoints(
      arrow,
      map,
      {
        points: minimalPoints,
        fixedSegments: null, // IMPORTANT: null (not [])
      },
      { isDragging: true }, // “like drag” produces stable exits with padding
    );
    if (!upd1 || (!upd1.points && !upd1.width && !upd1.height)) continue;

    const mid = { ...arrow, ...upd1 };
    map.set(arrow.id, mid); // so the next pass sees latest geometry

    // Pass 2: renormalize like mouseup
    const upd2 = updateElbowArrowPoints(mid, map, {}, { isDragging: false });

    updates.set(arrow.id, bumpVersion({ ...mid, ...(upd2 ?? {}) }));
  }

  if (updates.size) {
    const next = all.map((el) => updates.get(el.id) ?? el);
    api.updateScene({ elements: next });
  }
}

export function rerouteElbowsTouchingFrames(
  all: readonly ExcalidrawElement[],
  changedFrameIds: string[],
  zoom: { value: number },
) {
  const live = all.filter((e) => !e.isDeleted);
  const elementsMap = new Map(live.map((e) => [e.id, e])) as any; // full map
  const changed = new Set(changedFrameIds);
  const updates = new Map<string, ExcalidrawElement>();

  for (const el of live) {
    if (el.type !== "arrow") continue;
    const arrow = el as any;
    const isElbow =
      arrow.elbowed === true || (arrow.fixedSegments?.length ?? 0) > 0;
    if (!isElbow) continue;

    const sb = arrow.startBinding?.elementId;
    const eb = arrow.endBinding?.elementId;
    if (!((sb && changed.has(sb)) || (eb && changed.has(eb)))) continue;

    // optional: skip pathological self-bound arrows if you want:
    if (sb && eb && sb === eb) continue;

    updates.set(arrow.id, recomputeElbowArrow(arrow, elementsMap, zoom));
  }

  return all.map((el) => updates.get(el.id) ?? el);
}

export const buildIndexes = (all: readonly ExcalidrawElement[]) => {
  const byId: ById = new Map(all.map((e) => [e.id, e] as const));
  const childrenByFrame = new Map<string, ExcalidrawElement[]>();
  for (const el of all) {
    if (el.frameId) {
      if (!childrenByFrame.has(el.frameId)) childrenByFrame.set(el.frameId, []);
      childrenByFrame.get(el.frameId)!.push(el);
    }
  }
  return { byId, childrenByFrame };
};

export const walkDescendants = (
  root: ExcalidrawElement,
  childrenByFrame: Map<string, ExcalidrawElement[]>,
  fn: (el: ExcalidrawElement) => void,
) => {
  const stack = [...(childrenByFrame.get(root.id) ?? [])];
  while (stack.length) {
    const el = stack.pop()!;
    fn(el);
    if (isFrame(el)) stack.push(...(childrenByFrame.get(el.id) ?? []));
  }
};
export const getFrameTitle = (frame: ExcalidrawFrameElement) => {
  const cd = (frame as any).customData ?? {};
  const title = String(cd.title ?? "").trim();
  const name = String((frame as any).name ?? "").trim();
  return title || name || frame.id;
};

export const computeHiddenGlobal = (byId: ById) => {
  const hidden = new Set<string>();
  for (const el of byId.values()) {
    let cur: ExcalidrawElement | undefined = el;
    while (cur?.frameId) {
      const parent = byId.get(cur.frameId);
      if (!parent) break;
      if ((parent as any).customData?.collapsed) {
        hidden.add(el.id);
        break;
      }
      cur = parent;
    }
  }
  return hidden;
};
export const applyHiddenByFrame = (
  all: readonly ExcalidrawElement[],
  hidden: Set<string>,
) => {
  return all.map((el) => {
    const cd = (el as any).customData ?? {};
    const nextHidden = hidden.has(el.id);
    const prevHidden = !!cd.__hiddenByFrame;

    // no change → keep same reference
    if (prevHidden === nextHidden) return el;

    if (nextHidden) {
      // mark hidden, do not touch isDeleted
      return {
        ...el,
        customData: { ...cd, __hiddenByFrame: true },
      } as ExcalidrawElement;
    }

    // unhide: remove the flag, leave other customData intact, don't revive deletes
    const { __hiddenByFrame, ...rest } = cd;
    return {
      ...el,
      customData: Object.keys(rest).length ? rest : undefined,
    } as ExcalidrawElement;
  });
};
