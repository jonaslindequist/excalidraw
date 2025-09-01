// overlay-logic.ts
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";

export type ById = Map<string, ExcalidrawElement>;

export const isFrame = (el: ExcalidrawElement): el is ExcalidrawFrameElement =>
  el.type === "frame";

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
