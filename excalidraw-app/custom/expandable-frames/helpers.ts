import {
  ExcalidrawArrowElement,
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";

export type ElementsById = Map<string, ExcalidrawElement>;
export type ChildrenByFrame = Map<string, ExcalidrawElement[]>;

export const isFrame = (el: ExcalidrawElement): el is ExcalidrawFrameElement =>
  el.type === "frame";

export const isArrow = (el: ExcalidrawElement): el is ExcalidrawArrowElement =>
  el.type === "arrow";

// Build fast indexes to avoid repeated scans.
export function buildIndexes(all: readonly ExcalidrawElement[]) {
  const byId: ElementsById = new Map();
  const childrenByFrame: ChildrenByFrame = new Map();
  for (const el of all) {
    byId.set(el.id, el);
    if (el.frameId) {
      if (!childrenByFrame.has(el.frameId)) childrenByFrame.set(el.frameId, []);
      childrenByFrame.get(el.frameId)!.push(el);
    }
  }
  return { byId, childrenByFrame };
}

// Traverse descendants of a frame (depth-first)
export function walkDescendants(
  root: ExcalidrawFrameElement,
  childrenByFrame: ChildrenByFrame,
  fn: (el: ExcalidrawElement) => void,
) {
  const stack: ExcalidrawElement[] = [...(childrenByFrame.get(root.id) ?? [])];
  while (stack.length) {
    const el = stack.pop()!;
    fn(el);
    if (isFrame(el)) {
      const kids = childrenByFrame.get(el.id);
      if (kids?.length) stack.push(...kids);
    }
  }
}

// Hide/show elements *without* destroying user deletions.
// We only flip `isDeleted` for elements we previously hid (`__hiddenByFrame`).
export function setHiddenByFrame(
  elements: readonly ExcalidrawElement[],
  toHide: Set<string>,
) {
  return elements.map((el) => {
    const shouldHide = toHide.has(el.id);
    if (shouldHide) {
      if (el.isDeleted && !(el as any).customData?.__hiddenByFrame) {
        // user-deleted; leave it alone
        return el;
      }
      return {
        ...el,
        isDeleted: true,
        customData: { ...(el as any).customData, __hiddenByFrame: true },
      } as ExcalidrawElement;
    } else {
      // restore only if it was hidden by us
      if ((el as any).customData?.__hiddenByFrame) {
        const { __hiddenByFrame, ...rest } = (el as any).customData;
        return {
          ...el,
          isDeleted: false,
          customData: Object.keys(rest).length ? rest : undefined,
        } as ExcalidrawElement;
      }
      return el;
    }
  });
}

// Utility to collect connectors that reference hidden endpoints
export function collectArrowsTouching(
  elements: readonly ExcalidrawElement[],
  hiddenIds: Set<string>,
) {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!isArrow(el)) continue;
    const from = el?.startBinding?.elementId;
    const to = el?.endBinding?.elementId;
    if ((from && hiddenIds.has(from)) || (to && hiddenIds.has(to))) {
      ids.add(el.id);
    }
  }
  return ids;
}
