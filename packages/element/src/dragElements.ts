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

const collectRecursiveFrameChildren = (
  frameIds: string[],
  scene: Scene,
  visited = new Set<string>(),
): NonDeletedExcalidrawElement[] => {
  const elementsToAdd: NonDeletedExcalidrawElement[] = [];
  const all = scene.getNonDeletedElementsIncludingHidden();
  console.log("All: ", all);
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
    console.log("Children: ", recursiveChildren);
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
