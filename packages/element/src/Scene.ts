// DROP-IN START ---------------------------------------------------------------
import throttle from "lodash.throttle";

import {
  arrayToMap,
  isDevEnv,
  isTestEnv,
  randomInteger,
  toArray,
  toBrandedType,
} from "@excalidraw/common";
import {
  ensureFrameBeforeChildren,
  getElementsInGroup,
  isFrameLikeElement,
  isNonDeletedElement,
} from "@excalidraw/element";

import {
  syncInvalidIndices,
  syncMovedIndices,
  validateFractionalIndices,
} from "@excalidraw/element";

import { getSelectedElements } from "@excalidraw/element";

import { mutateElement, type ElementUpdate } from "@excalidraw/element";

import type {
  ElementsMapOrArray,
  ExcalidrawElement,
  ExcalidrawFrameLikeElement,
  NonDeleted,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
  Ordered,
  OrderedExcalidrawElement,
  SceneElementsMap,
} from "@excalidraw/element/types";

import type {
  Assert,
  Mutable,
  SameType,
} from "@excalidraw/common/utility-types";

import type { AppState } from "../../excalidraw/types";

type SceneStateCallback = () => void;
type SceneStateCallbackRemover = () => void;

type SelectionHash = string & { __brand: "selectionHash" };

/** --------------------------
 * Internal helpers
 * -------------------------- */
const getNonDeletedElements = <T extends ExcalidrawElement>(
  allElements: readonly T[],
) => {
  const elementsMap = new Map() as NonDeletedSceneElementsMap;
  const elements: T[] = [];
  for (const element of allElements) {
    if (!element.isDeleted) {
      elements.push(element as NonDeleted<T>);
      elementsMap.set(
        element.id,
        element as Ordered<NonDeletedExcalidrawElement>,
      );
    }
  }
  return { elementsMap, elements };
};

const isHiddenByFrame = (el: ExcalidrawElement) =>
  !!(el as any).customData?.__hiddenByFrame;

const isRenderable = (el: ExcalidrawElement) =>
  !el.isDeleted && !isHiddenByFrame(el);

const validateIndicesThrottled = throttle(
  (elements: readonly ExcalidrawElement[]) => {
    if (
      isDevEnv() ||
      isTestEnv() ||
      (window as any)?.DEBUG_FRACTIONAL_INDICES
    ) {
      validateFractionalIndices(elements, {
        // throw only in dev & test, to remain functional on `DEBUG_FRACTIONAL_INDICES`
        shouldThrow: isDevEnv() || isTestEnv(),
        includeBoundTextValidation: true,
      });
    }
  },
  1000 * 60,
  { leading: true, trailing: false },
);

/** Include the hidden toggle in selection hash so the cache is correct */
const hashSelectionOpts = (
  opts: Parameters<InstanceType<typeof Scene>["getSelectedElements"]>[0],
) => {
  const keys = [
    "includeBoundTextElement",
    "includeElementsInFrames",
    "includeHiddenByFrame", // NEW
  ] as const;

  type HashableKeys = Omit<typeof opts, "selectedElementIds" | "elements">;

  // just to ensure we're hashing all expected keys
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type _ = Assert<
    SameType<
      Required<HashableKeys>,
      Pick<Required<HashableKeys>, typeof keys[number]>
    >
  >;

  let hash = "";
  for (const key of keys) {
    hash += `${key}:${(opts as any)[key] ? "1" : "0"}`;
  }
  return hash as SelectionHash;
};

// ideally this would be a branded type but it'd be insanely hard to work with
// in our codebase
export type ExcalidrawElementsIncludingDeleted = readonly ExcalidrawElement[];

export class Scene {
  // ---------------------------------------------------------------------------
  // instance methods/props
  // ---------------------------------------------------------------------------

  private callbacks: Set<SceneStateCallback> = new Set();

  private nonDeletedElements: readonly Ordered<NonDeletedExcalidrawElement>[] =
    [];
  private nonDeletedElementsMap = toBrandedType<NonDeletedSceneElementsMap>(
    new Map(),
  );
  // ideally all elements within the scene should be wrapped around with `Ordered` type, but right now there is no real benefit doing so
  private elements: readonly OrderedExcalidrawElement[] = [];
  private nonDeletedFramesLikes: readonly NonDeleted<ExcalidrawFrameLikeElement>[] =
    [];
  private frames: readonly ExcalidrawFrameLikeElement[] = [];
  private elementsMap = toBrandedType<SceneElementsMap>(new Map());
  private selectedElementsCache: {
    selectedElementIds: AppState["selectedElementIds"] | null;
    elements: readonly NonDeletedExcalidrawElement[] | null;
    cache: Map<SelectionHash, NonDeletedExcalidrawElement[]>;
  } = {
    selectedElementIds: null,
    elements: null,
    cache: new Map(),
  };
  /**
   * Random integer regenerated each scene update.
   *
   * Does not relate to elements versions, it's only a renderer
   * cache-invalidation nonce at the moment.
   */
  private sceneNonce: number | undefined;

  getSceneNonce() {
    return this.sceneNonce;
  }

  /** Non-deleted map (may include hidden-by-frame). Keep for backwards compat. */
  getNonDeletedElementsMap() {
    return this.nonDeletedElementsMap;
  }

  getElementsIncludingDeleted() {
    return this.elements;
  }

  getElementsMapIncludingDeleted() {
    return this.elementsMap;
  }

  /** All non-deleted (visible + hidden-by-frame). */
  getNonDeletedElements() {
    return this.nonDeletedElements;
  }

  getFramesIncludingDeleted() {
    return this.frames;
  }

  /** Kept for compatibility; returns all non-deleted (including hidden). */
  getNonDeletedElementsIncludingHidden(): readonly NonDeletedExcalidrawElement[] {
    return this.elements.filter(
      (el) => !el.isDeleted,
    ) as readonly NonDeletedExcalidrawElement[];
  }

  /** Preferred: elements that should render / hit-test */
  getVisibleElements(): readonly NonDeletedExcalidrawElement[] {
    return this.elements.filter(
      isRenderable,
    ) as readonly NonDeletedExcalidrawElement[];
  }

  /** Preferred: map of visible elements */
  getVisibleElementsMap() {
    const map = new Map() as NonDeletedSceneElementsMap;
    for (const el of this.elements) {
      if (isRenderable(el)) {
        map.set(el.id, el as Ordered<NonDeletedExcalidrawElement>);
      }
    }
    return map;
  }

  constructor(elements: ElementsMapOrArray | null = null) {
    if (elements) {
      this.replaceAllElements(elements);
    }
  }

  getSelectedElements(opts: {
    // NOTE can be ommitted by making Scene constructor require App instance
    selectedElementIds: AppState["selectedElementIds"];
    /**
     * for specific cases where you need to use elements not from current
     * scene state. This in effect will likely result in cache-miss, and
     * the cache won't be updated in this case.
     */
    elements?: ElementsMapOrArray;
    // selection-related options
    includeBoundTextElement?: boolean;
    includeElementsInFrames?: boolean;
    /** NEW: opt-in to include hidden-by-frame elements in selection base */
    includeHiddenByFrame?: boolean;
  }): NonDeleted<ExcalidrawElement>[] {
    const hash = hashSelectionOpts(opts);

    // Determine base set:
    const baseElements: readonly NonDeletedExcalidrawElement[] = opts?.elements
      ? (toArray(opts.elements).filter(
          (el) =>
            !el.isDeleted &&
            (opts.includeHiddenByFrame ? true : !isHiddenByFrame(el)),
        ) as readonly NonDeletedExcalidrawElement[])
      : opts.includeHiddenByFrame
      ? this.nonDeletedElements // all non-deleted
      : this.getVisibleElements(); // default: visible only

    // Cache hit?
    if (
      this.selectedElementsCache.elements === baseElements &&
      this.selectedElementsCache.selectedElementIds === opts.selectedElementIds
    ) {
      const cached = this.selectedElementsCache.cache.get(hash);
      if (cached) {
        return cached;
      }
    } else if (opts?.elements == null) {
      // operating on latest scene elements but base changed => clear cache
      this.selectedElementsCache.cache.clear();
    }

    const selectedElements = getSelectedElements(
      baseElements,
      { selectedElementIds: opts.selectedElementIds },
      opts,
    );

    // Cache only when using scene’s latest elements
    if (opts?.elements == null) {
      this.selectedElementsCache.selectedElementIds = opts.selectedElementIds;
      this.selectedElementsCache.elements = baseElements;
      this.selectedElementsCache.cache.set(hash, selectedElements);
    }

    return selectedElements;
  }

  getNonDeletedFramesLikes(): readonly NonDeleted<ExcalidrawFrameLikeElement>[] {
    return this.nonDeletedFramesLikes;
  }

  getElement<T extends ExcalidrawElement>(id: T["id"]): T | null {
    return (this.elementsMap.get(id) as T | undefined) || null;
  }

  getNonDeletedElement(
    id: ExcalidrawElement["id"],
  ): NonDeleted<ExcalidrawElement> | null {
    const element = this.getElement(id);
    if (element && isNonDeletedElement(element)) {
      return element;
    }
    return null;
  }

  /**
   * A utility method to help with updating all scene elements, with the added
   * performance optimization of not renewing the array if no change is made.
   *
   * Maps all current excalidraw elements, invoking the callback for each
   * element. The callback should either return a new mapped element, or the
   * original element if no changes are made. If no changes are made to any
   * element, this results in a no-op. Otherwise, the newly mapped elements
   * are set as the next scene's elements.
   *
   * @returns whether a change was made
   */
  mapElements(
    iteratee: (element: ExcalidrawElement) => ExcalidrawElement,
  ): boolean {
    let didChange = false;
    const newElements = this.elements.map((element) => {
      const nextElement = iteratee(element);
      if (nextElement !== element) {
        didChange = true;
      }
      return nextElement;
    });
    if (didChange) {
      this.replaceAllElements(newElements);
    }
    return didChange;
  }

  replaceAllElements(nextElements: ElementsMapOrArray) {
    // normalize and sanity-check indices (existing behavior)
    const _nextElements = toArray(nextElements);
    const nextFrameLikes: ExcalidrawFrameLikeElement[] = [];

    validateIndicesThrottled(_nextElements);

    // 1) normalize fractional indices first (keeps rest of pipeline happy)
    let arr = syncInvalidIndices(_nextElements);

    // 2) enforce "frame before children" invariant (outermost → innermost)
    {
      const byId = new Map(arr.map((e) => [e.id, e] as const));
      const depth = (fid: string) => {
        let d = 0;
        let cur = byId.get(fid);
        while (cur?.frameId) {
          d++;
          cur = byId.get(cur.frameId);
        }
        return d;
      };
      const frames = arr
        .filter(isFrameLikeElement)
        .sort((a, b) => depth(a.id) - depth(b.id));

      for (const f of frames) {
        arr = ensureFrameBeforeChildren(arr, f.id) as typeof arr;
      }

      // keep indices consistent after reordering (only order changed)
      syncMovedIndices(arr, new Map());
    }

    // 3) write through to scene state (existing behavior)
    this.elements = arr;
    this.elementsMap.clear();

    for (const element of this.elements) {
      if (isFrameLikeElement(element)) {
        nextFrameLikes.push(element);
      }
      this.elementsMap.set(element.id, element);
    }

    const nonDeleted = getNonDeletedElements(this.elements);
    this.nonDeletedElements = nonDeleted.elements;
    this.nonDeletedElementsMap = nonDeleted.elementsMap;

    this.frames = nextFrameLikes;
    this.nonDeletedFramesLikes = getNonDeletedElements(this.frames).elements;

    this.triggerUpdate();
  }

  triggerUpdate() {
    this.sceneNonce = randomInteger();

    for (const callback of Array.from(this.callbacks)) {
      callback();
    }
  }

  onUpdate(cb: SceneStateCallback): SceneStateCallbackRemover {
    if (this.callbacks.has(cb)) {
      throw new Error();
    }

    this.callbacks.add(cb);

    return () => {
      if (!this.callbacks.has(cb)) {
        throw new Error();
      }
      this.callbacks.delete(cb);
    };
  }

  destroy() {
    this.elements = [];
    this.nonDeletedElements = [];
    this.nonDeletedFramesLikes = [];
    this.frames = [];
    this.elementsMap.clear();
    this.selectedElementsCache.selectedElementIds = null;
    this.selectedElementsCache.elements = null;
    this.selectedElementsCache.cache.clear();

    // done not for memory leaks, but to guard against possible late fires
    // (I guess?)
    this.callbacks.clear();
  }

  insertElementAtIndex(element: ExcalidrawElement, index: number) {
    if (!Number.isFinite(index) || index < 0) {
      throw new Error(
        "insertElementAtIndex can only be called with index >= 0",
      );
    }

    const nextElements = [
      ...this.elements.slice(0, index),
      element,
      ...this.elements.slice(index),
    ];

    syncMovedIndices(nextElements, arrayToMap([element]));

    this.replaceAllElements(nextElements);
  }

  insertElementsAtIndex(elements: ExcalidrawElement[], index: number) {
    if (!elements.length) {
      return;
    }

    if (!Number.isFinite(index) || index < 0) {
      throw new Error(
        "insertElementAtIndex can only be called with index >= 0",
      );
    }

    const nextElements = [
      ...this.elements.slice(0, index),
      ...elements,
      ...this.elements.slice(index),
    ];

    syncMovedIndices(nextElements, arrayToMap(elements));

    this.replaceAllElements(nextElements);
  }

  insertElement = (element: ExcalidrawElement) => {
    const index = element.frameId
      ? this.getElementIndex(element.frameId)
      : this.elements.length;

    this.insertElementAtIndex(element, index);
  };

  insertElements = (elements: ExcalidrawElement[]) => {
    if (!elements.length) {
      return;
    }

    const index = elements[0]?.frameId
      ? this.getElementIndex(elements[0].frameId)
      : this.elements.length;

    this.insertElementsAtIndex(elements, index);
  };

  getElementIndex(elementId: string) {
    return this.elements.findIndex((element) => element.id === elementId);
  }

  getContainerElement = (
    element:
      | (ExcalidrawElement & {
          containerId: ExcalidrawElement["id"] | null;
        })
      | null,
  ) => {
    if (!element) {
      return null;
    }
    if (element.containerId) {
      return this.getElement(element.containerId) || null;
    }
    return null;
  };

  /** Default to visible map; provide a companion "including hidden" helper. */
  getElementsFromId = (id: string): ExcalidrawElement[] => {
    const elementsMap = this.getVisibleElementsMap(); // changed
    const el = elementsMap.get(id);
    if (el) {
      return [el];
    }
    return getElementsInGroup(elementsMap, id);
  };

  /** If a caller explicitly needs hidden-by-frame too */
  getElementsFromIdIncludingHidden = (id: string): ExcalidrawElement[] => {
    const elementsMap = this.getNonDeletedElementsMap();
    const el = elementsMap.get(id);
    if (el) {
      return [el];
    }
    return getElementsInGroup(elementsMap, id);
  };

  // Mutate an element with passed updates and trigger the component to update. Make sure you
  // are calling it either from a React event handler or within unstable_batchedUpdates().
  mutateElement<TElement extends Mutable<ExcalidrawElement>>(
    element: TElement,
    updates: ElementUpdate<TElement>,
    options: {
      informMutation: boolean;
      isDragging: boolean;
    } = {
      informMutation: true,
      isDragging: false,
    },
  ) {
    // Use visible map by default so hidden-by-frame elements don't affect constraints/hittest
    const elementsMap = this.getVisibleElementsMap(); // changed

    const { version: prevVersion } = element;
    const { version: nextVersion } = mutateElement(
      element,
      elementsMap,
      updates,
      options,
    );

    if (
      // skip if the element is not in the scene (i.e. selection)
      this.elementsMap.has(element.id) &&
      // skip if the element's version hasn't changed, as mutateElement returned the same element
      prevVersion !== nextVersion &&
      options.informMutation
    ) {
      this.triggerUpdate();
    }

    return element;
  }
}
// DROP-IN END -----------------------------------------------------------------
