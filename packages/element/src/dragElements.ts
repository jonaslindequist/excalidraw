import {
  TEXT_AUTOWRAP_THRESHOLD,
  getFontString,
  getGridPoint,
} from "@excalidraw/common";

import type {
  AppState,
  NormalizedZoomValue,
  NullableGridSize,
  PointerDownState,
} from "@excalidraw/excalidraw/types";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { updateBoundElements } from "./binding";
import { getCommonBounds } from "./bounds";
import { getPerfectElementSize } from "./sizeHelpers";
import { getBoundTextElement } from "./textElement";
import { getMinTextElementWidth } from "./textMeasurements";
import {
  isArrowElement,
  isElbowArrow,
  isFrameLikeElement,
  isImageElement,
  isTextElement,
} from "./typeChecks";

import type { Scene } from "./Scene";

import type { Bounds } from "./bounds";
import type { ExcalidrawElement } from "./types";

const DEBUG_DRAG_FRAMES = false; // set false to silence logs

const dbg = (...args: any[]) => {
  if (DEBUG_DRAG_FRAMES) console.log(...args);
};
const dbgg = (label: string) => {
  if (DEBUG_DRAG_FRAMES && console.groupCollapsed)
    console.groupCollapsed(label);
};
const dbge = () => {
  if (DEBUG_DRAG_FRAMES && console.groupEnd) console.groupEnd();
};

// try to read a "parent frame" hint from customData.__hiddenByFrame
const getHiddenParentId = (el: any): string | null => {
  const v = el?.customData?.__hiddenByFrame;
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    // common shapes: { parentId } or { frameId }
    return v.parentId || v.frameId || null;
  }
  return null;
};

// Debug end

const getById = (arr: readonly ExcalidrawElement[]) =>
  new Map(arr.map((e) => [e.id, e] as const));

const isDescOf = (
  el: ExcalidrawElement,
  rootId: string,
  byId: Map<string, ExcalidrawElement>,
) => {
  let cur: ExcalidrawElement | undefined = el;
  while (cur?.frameId) {
    if (cur.frameId === rootId) return true;
    cur = byId.get(cur.frameId);
  }
  return false;
};

// indices of a frame's full subtree (all descendants, + the frame itself)
const getSubtreeIndices = (
  elements: readonly ExcalidrawElement[],
  frameId: string,
) => {
  const byId = getById(elements);
  const out: number[] = [];
  for (let i = 0; i < elements.length; i++) {
    const e = elements[i];
    if (e.id === frameId || isDescOf(e, frameId, byId)) out.push(i);
  }
  return out;
};

// AABB overlap check
const rectsOverlap = (a: ExcalidrawElement, b: ExcalidrawElement): boolean => {
  const ax1 = a.x,
    ay1 = a.y,
    ax2 = a.x + a.width,
    ay2 = a.y + a.height;
  const bx1 = b.x,
    by1 = b.y,
    bx2 = b.x + b.width,
    by2 = b.y + b.height;
  return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
};

// Reorder: move all `movingBlocks` so they appear immediately before `targetFrameId`
const previewReorderBeforeFrame = (
  scene: Scene,
  movingFrameIds: string[],
  targetFrameId: string,
) => {
  const all = scene.getNonDeletedElementsIncludingHidden();
  const byId = getById(all);

  // Collect indices to move (full subtrees)
  const toMoveIdx = new Set<number>();
  for (const fid of movingFrameIds) {
    for (const i of getSubtreeIndices(all, fid)) toMoveIdx.add(i);
  }
  if (!toMoveIdx.size) return;

  // Split moving/staying preserving order
  const moving: ExcalidrawElement[] = [];
  const staying: ExcalidrawElement[] = [];
  all.forEach((el, i) =>
    toMoveIdx.has(i) ? moving.push(el) : staying.push(el),
  );

  // Where to insert in STAYING? Just before the target frame (its current pos in staying)
  const insertAt = staying.findIndex((e) => e.id === targetFrameId);
  if (insertAt < 0) return;

  const next = [
    ...staying.slice(0, insertAt),
    ...moving,
    ...staying.slice(insertAt),
  ];

  // Apply (Scene usually exposes a replace/update; fall back to mutate if needed)
  if ((scene as any).replaceAllElements) {
    (scene as any).replaceAllElements(next);
  } else if ((scene as any).app?.updateScene) {
    (scene as any).app.updateScene({ elements: next });
  }
};

const collectRecursiveFrameChildren = (
  frameIds: string[],
  scene: Scene,
  visited = new Set<string>(),
): NonDeletedExcalidrawElement[] => {
  const elementsToAdd: NonDeletedExcalidrawElement[] = [];
  const all = scene.getNonDeletedElementsIncludingHidden();
  let considered = 0,
    matched = 0,
    recursed = 0;

  for (const element of all) {
    considered++;

    const inByFrameId = !!element.frameId && frameIds.includes(element.frameId);

    // DEBUG: if collapse clears frameId, try to *detect* a relationship via __hiddenByFrame
    const hiddenParentId = getHiddenParentId(element as any);
    const inByHiddenHint =
      !!hiddenParentId && frameIds.includes(hiddenParentId);

    if ((inByFrameId || inByHiddenHint) && !visited.has(element.id)) {
      visited.add(element.id);
      elementsToAdd.push(element);
      matched++;

      if (isFrameLikeElement(element)) {
        recursed++;
        const recursiveChildren = collectRecursiveFrameChildren(
          [element.id],
          scene,
          visited,
        );
        elementsToAdd.push(...recursiveChildren);
      }
    }
  }

  dbg(
    `[collector] frames=${JSON.stringify(
      frameIds,
    )} considered=${considered} matched=${matched} recursedIntoFrames=${recursed} added=${
      elementsToAdd.length
    }`,
  );

  if (DEBUG_DRAG_FRAMES && matched === 0) {
    // Helpful warning: you selected a frame but nothing matched inside.
    dbg(
      `[collector] WARNING: no children found. Do your collapsed descendants keep frameId or __hiddenByFrame?`,
    );
  }

  return elementsToAdd;
};

export const dragSelectedElements = (
  pointerDownState: PointerDownState,
  _selectedElements: NonDeletedExcalidrawElement[],
  offset: { x: number; y: number },
  scene: Scene,
  snapOffset: {
    x: number;
    y: number;
  },
  gridSize: NullableGridSize,
) => {
  if (
    _selectedElements.length === 1 &&
    isElbowArrow(_selectedElements[0]) &&
    (_selectedElements[0].startBinding || _selectedElements[0].endBinding)
  ) {
    return;
  }

  const selectedElements = _selectedElements.filter((element) => {
    if (isElbowArrow(element) && element.startBinding && element.endBinding) {
      const startElement = _selectedElements.find(
        (el) => el.id === element.startBinding?.elementId,
      );
      const endElement = _selectedElements.find(
        (el) => el.id === element.endBinding?.elementId,
      );

      return startElement && endElement;
    }

    return true;
  });

  // we do not want a frame and its elements to be selected at the same time
  // but when it happens (due to some bug), we want to avoid updating element
  // in the frame twice, hence the use of set
  const elementsToUpdate = new Set<NonDeletedExcalidrawElement>(
    selectedElements,
  );
  const frames = selectedElements
    .filter((e) => isFrameLikeElement(e))
    .map((f) => f.id);

  if (frames.length > 0) {
    const recursiveChildren = collectRecursiveFrameChildren(frames, scene);

    for (const el of recursiveChildren) {
      elementsToUpdate.add(el);
      if (!pointerDownState.originalElements.has(el.id)) {
        // Seed baseline as position at DRAG START:
        // current position minus total drag delta so far.
        pointerDownState.originalElements.set(el.id, {
          ...el,
          x: el.x - offset.x,
          y: el.y - offset.y,
        });
      }
    }
  }

  const origElements: ExcalidrawElement[] = [];

  for (const element of elementsToUpdate) {
    const origElement =
      pointerDownState.originalElements.get(element.id) ?? element;
    origElements.push(origElement);
  }

  const adjustedOffset = calculateOffset(
    getCommonBounds(origElements),
    offset,
    snapOffset,
    gridSize,
  );

  elementsToUpdate.forEach((element) => {
    updateElementCoords(pointerDownState, element, scene, adjustedOffset);
    if (!isArrowElement(element)) {
      // skip arrow labels since we calculate its position during render
      const textElement = getBoundTextElement(
        element,
        scene.getNonDeletedElementsMap(),
      );
      if (textElement) {
        updateElementCoords(
          pointerDownState,
          textElement,
          scene,
          adjustedOffset,
        );
      }
      updateBoundElements(element, scene, {
        simultaneouslyUpdated: Array.from(elementsToUpdate),
      });

      const movingFrameIds = selectedElements
        .filter((e) => isFrameLikeElement(e))
        .map((e) => e.id);

      if (movingFrameIds.length) {
        const all = scene.getNonDeletedElementsIncludingHidden();
        const byId = getById(all);

        // Top-most overlapping frame that is NOT (a) one of the moving frames,
        // and NOT (b) a descendant of any moving frame (avoid illegal parenting),
        // and NOT (c) an ancestor of the moving frames (also avoid cycles).
        const movingFrames = movingFrameIds
          .map((id) => byId.get(id)!)
          .filter(Boolean);

        const forbid = new Set<string>(movingFrameIds);
        // forbid ancestors of moving frames (can’t parent into own ancestor)
        for (const mf of movingFrames) {
          let cur = mf;
          while (cur.frameId) {
            forbid.add(cur.frameId);
            const p = byId.get(cur.frameId);
            if (!p) break;
            cur = p;
          }
        }

        // candidate = highest z (last in array) frame that overlaps any moving frame
        // and isn’t forbidden
        let candidate: ExcalidrawElement | undefined;
        for (let i = all.length - 1; i >= 0; i--) {
          const el = all[i];
          if (!isFrameLikeElement(el)) continue;
          if (forbid.has(el.id)) continue;

          // overlap any moving frame?
          if (movingFrames.some((mf) => rectsOverlap(mf, el))) {
            candidate = el;
            break;
          }
        }

        // Only re-run when target changes
        const keyNow = candidate
          ? `${movingFrameIds.sort().join(",")}->${candidate.id}`
          : "";
        const lastKey = (pointerDownState as any).__zPreviewKey as
          | string
          | undefined;
        if (keyNow && keyNow !== lastKey) {
          previewReorderBeforeFrame(scene, movingFrameIds, candidate!.id);
          (pointerDownState as any).__zPreviewKey = keyNow;
        } else if (!candidate) {
          // Leaving a frame: clear the key so we can preview again later
          (pointerDownState as any).__zPreviewKey = "";
        }
      }
    }
  });
};

const calculateOffset = (
  commonBounds: Bounds,
  dragOffset: { x: number; y: number },
  snapOffset: { x: number; y: number },
  gridSize: NullableGridSize,
): { x: number; y: number } => {
  const [x, y] = commonBounds;
  let nextX = x + dragOffset.x + snapOffset.x;
  let nextY = y + dragOffset.y + snapOffset.y;

  if (snapOffset.x === 0 || snapOffset.y === 0) {
    const [nextGridX, nextGridY] = getGridPoint(
      x + dragOffset.x,
      y + dragOffset.y,
      gridSize,
    );

    if (snapOffset.x === 0) {
      nextX = nextGridX;
    }

    if (snapOffset.y === 0) {
      nextY = nextGridY;
    }
  }
  return {
    x: nextX - x,
    y: nextY - y,
  };
};

const updateElementCoords = (
  pointerDownState: PointerDownState,
  element: NonDeletedExcalidrawElement,
  scene: Scene,
  dragOffset: { x: number; y: number },
) => {
  const originalElement =
    pointerDownState.originalElements.get(element.id) ?? element;

  const nextX = originalElement.x + dragOffset.x;
  const nextY = originalElement.y + dragOffset.y;

  scene.mutateElement(element, {
    x: nextX,
    y: nextY,
  });
};

export const getDragOffsetXY = (
  selectedElements: NonDeletedExcalidrawElement[],
  x: number,
  y: number,
): [number, number] => {
  const [x1, y1] = getCommonBounds(selectedElements);
  return [x - x1, y - y1];
};

export const dragNewElement = ({
  newElement,
  elementType,
  originX,
  originY,
  x,
  y,
  width,
  height,
  shouldMaintainAspectRatio,
  shouldResizeFromCenter,
  zoom,
  scene,
  widthAspectRatio = null,
  originOffset = null,
  informMutation = true,
}: {
  newElement: NonDeletedExcalidrawElement;
  elementType: AppState["activeTool"]["type"];
  originX: number;
  originY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  shouldMaintainAspectRatio: boolean;
  shouldResizeFromCenter: boolean;
  zoom: NormalizedZoomValue;
  scene: Scene;
  /** whether to keep given aspect ratio when `isResizeWithSidesSameLength` is
      true */
  widthAspectRatio?: number | null;
  originOffset?: {
    x: number;
    y: number;
  } | null;
  informMutation?: boolean;
}) => {
  if (shouldMaintainAspectRatio && newElement.type !== "selection") {
    if (widthAspectRatio) {
      height = width / widthAspectRatio;
    } else {
      // Depending on where the cursor is at (x, y) relative to where the starting point is
      // (originX, originY), we use ONLY width or height to control size increase.
      // This allows the cursor to always "stick" to one of the sides of the bounding box.
      if (Math.abs(y - originY) > Math.abs(x - originX)) {
        ({ width, height } = getPerfectElementSize(
          elementType,
          height,
          x < originX ? -width : width,
        ));
      } else {
        ({ width, height } = getPerfectElementSize(
          elementType,
          width,
          y < originY ? -height : height,
        ));
      }

      if (height < 0) {
        height = -height;
      }
    }
  }

  let newX = x < originX ? originX - width : originX;
  let newY = y < originY ? originY - height : originY;

  if (shouldResizeFromCenter) {
    width += width;
    height += height;
    newX = originX - width / 2;
    newY = originY - height / 2;
  }

  let textAutoResize = null;

  if (isTextElement(newElement)) {
    height = newElement.height;
    const minWidth = getMinTextElementWidth(
      getFontString({
        fontSize: newElement.fontSize,
        fontFamily: newElement.fontFamily,
      }),
      newElement.lineHeight,
    );
    width = Math.max(width, minWidth);

    if (Math.abs(x - originX) > TEXT_AUTOWRAP_THRESHOLD / zoom) {
      textAutoResize = {
        autoResize: false,
      };
    }

    newY = originY;
    if (shouldResizeFromCenter) {
      newX = originX - width / 2;
    }
  }

  if (width !== 0 && height !== 0) {
    let imageInitialDimension = null;
    if (isImageElement(newElement)) {
      imageInitialDimension = {
        initialWidth: width,
        initialHeight: height,
      };
    }

    scene.mutateElement(
      newElement,
      {
        x: newX + (originOffset?.x ?? 0),
        y: newY + (originOffset?.y ?? 0),
        width,
        height,
        ...textAutoResize,
        ...imageInitialDimension,
      },
      { informMutation, isDragging: false },
    );
  }
};
