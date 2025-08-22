// imperativeOverlay.ts
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const COLLAPSED_W = 200;
const COLLAPSED_H = 100;

type ById = Map<string, ExcalidrawElement>;

const isFrame = (el: ExcalidrawElement): el is ExcalidrawFrameElement =>
  el.type === "frame";

// Build maps: byId and childrenByFrame
const buildIndexes = (all: readonly ExcalidrawElement[]) => {
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

// DFS over descendants
const walkDescendants = (
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

// Compute elements hidden by any collapsed ancestor frame
const computeHiddenGlobal = (byId: ById) => {
  const hidden = new Set<string>();
  for (const el of byId.values()) {
    // bubble up through frame parents
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

// Apply hidden set using isDeleted, tagging with __hiddenByFrame
const applyHiddenByFrame = (
  all: readonly ExcalidrawElement[],
  hidden: Set<string>,
) => {
  return all.map((el) => {
    const cd = (el as any).customData ?? {};
    const shouldHide = hidden.has(el.id);

    if (shouldHide) {
      if (el.isDeleted && !cd.__hiddenByFrame) return el; // user-deleted stays
      if (!el.isDeleted || !cd.__hiddenByFrame) {
        return {
          ...el,
          isDeleted: true,
          customData: { ...cd, __hiddenByFrame: true },
        } as ExcalidrawElement;
      }
      return el;
    }

    // should be visible
    if (cd.__hiddenByFrame) {
      const { __hiddenByFrame, ...rest } = cd;
      return {
        ...el,
        isDeleted: false,
        customData: Object.keys(rest).length ? rest : undefined,
      } as ExcalidrawElement;
    }
    return el;
  });
};

export function revealElement(
  api: ExcalidrawImperativeAPI,
  elementId: string,
  opts?: {
    select?: boolean; // default true
    scroll?: boolean; // default true
    animate?: boolean; // default true
    fitToContent?: boolean; // default true
  },
) {
  const select = opts?.select ?? true;
  const scroll = opts?.scroll ?? true;
  const animate = opts?.animate ?? true;
  const fitToContent = opts?.fitToContent ?? true;

  const all = api.getSceneElementsIncludingDeleted();
  const { byId, childrenByFrame } = buildIndexes(all);

  const target = byId.get(elementId);
  if (!target) return;

  // 1) collect collapsed ancestor frames we need to expand
  const framesToExpand: ExcalidrawFrameElement[] = [];
  let cur: ExcalidrawElement | undefined = target;
  while (cur?.frameId) {
    const parent = byId.get(cur.frameId);
    if (!parent || parent.type !== "frame") break;
    const collapsed = !!(parent as any).customData?.collapsed;
    if (collapsed) framesToExpand.push(parent as ExcalidrawFrameElement);
    cur = parent;
  }

  // 2) expand them in one batch (restore originalSize when available)
  let working = all as ExcalidrawElement[];
  if (framesToExpand.length) {
    working = working.map((el) => {
      const f = framesToExpand.find((fr) => fr.id === el.id);
      if (!f) return el;
      const cd = (f as any).customData ?? {};
      const size = cd.originalSize ?? { w: f.width, h: f.height };
      return {
        ...el,
        width: size.w,
        height: size.h,
        customData: {
          ...cd,
          expandable: true,
          collapsed: false,
          originalSize: size,
        },
      } as ExcalidrawElement;
    });

    // 3) recompute visibility + apply isDeleted/__hiddenByFrame
    const updatedById: ById = new Map(working.map((e) => [e.id, e] as const));
    const hidden = computeHiddenGlobal(updatedById);
    working = applyHiddenByFrame(working, hidden);

    api.updateScene({ elements: working });
  }

  // 4) optionally select & scroll to the element
  if (select) {
    api.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
    });
  }

  if (scroll) {
    const updatedTarget =
      api.getSceneElementsIncludingDeleted().find((e) => e.id === elementId) ??
      target;

    api.scrollToContent(updatedTarget, {
      animate,
      fitToContent,
    });
  }
}

// PUBLIC: collapse/expand a frame (optionally recursive)
export function toggleFrameCollapsed(
  api: ExcalidrawImperativeAPI,
  frameId: string,
  opts?: { recursive?: boolean },
) {
  const all = api.getSceneElementsIncludingDeleted();
  const { byId, childrenByFrame } = buildIndexes(all);
  const rootFrame = byId.get(frameId);
  if (!rootFrame || !isFrame(rootFrame)) return;

  const desiredCollapsed = !(rootFrame as any).customData?.collapsed;

  const framesToToggle: ExcalidrawFrameElement[] = [rootFrame];
  if (opts?.recursive) {
    walkDescendants(rootFrame, childrenByFrame, (el) => {
      if (isFrame(el)) framesToToggle.push(el);
    });
  }

  const updated = all.map((el) => {
    const f = framesToToggle.find((fr) => fr.id === el.id);
    if (!f) return el;
    const prevCD = (f as any).customData ?? {};
    const nextOriginalSize = desiredCollapsed
      ? { w: f.width, h: f.height }
      : prevCD.originalSize ?? { w: f.width, h: f.height };

    return {
      ...el,
      width: desiredCollapsed ? COLLAPSED_W : nextOriginalSize.w,
      height: desiredCollapsed ? COLLAPSED_H : nextOriginalSize.h,
      customData: {
        ...prevCD,
        expandable: true,
        collapsed: desiredCollapsed,
        originalSize: nextOriginalSize,
      },
    } as ExcalidrawElement;
  });

  const updatedById: ById = new Map(updated.map((e) => [e.id, e] as const));
  const hidden = computeHiddenGlobal(updatedById);
  const next = applyHiddenByFrame(updated, hidden);

  api.updateScene({ elements: next });
}

// Mount overlay and return the root so you can dispatch exca:* events
export function mountExpandableFramesOverlay(
  api: ExcalidrawImperativeAPI,
  opts?: { container?: HTMLElement },
) {
  const buttons = new Map<string, HTMLButtonElement>();

  const overlayEl = document.createElement("div");
  Object.assign(overlayEl.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none", // root doesn’t eat clicks
    zIndex: "2147483647",
  } as CSSStyleDeclaration);

  (
    opts?.container ??
    (document.querySelector(".dock-center") as HTMLElement) ??
    document.body
  ).appendChild(overlayEl);

  const root = overlayEl; // use this for events & children

  const render = () => {
    const appState = api.getAppState();
    const elements = api.getSceneElements();

    const frames = elements.filter(
      (el) =>
        el.type === "frame" && (el as any).customData?.expandable === true,
    ) as ExcalidrawFrameElement[];

    // add/update buttons
    for (const frame of frames) {
      let btn = buttons.get(frame.id);
      if (!btn) {
        btn = document.createElement("button");
        Object.assign(btn.style, {
          position: "absolute",
          width: "24px",
          height: "24px",
          pointerEvents: "auto", // clickable
          border: "1px solid #ccc",
          borderRadius: "12px",
          background: "#fff",
          boxShadow: "0 1px 4px rgba(0,0,0,.12)",
          cursor: "pointer",
          userSelect: "none",
          zIndex: "2147483647",
          display: "grid",
          placeItems: "center",
          transition: "opacity 120ms ease, transform 120ms ease",
        } as CSSStyleDeclaration);

        btn.addEventListener("mousedown", (e) => e.stopPropagation());
        btn.addEventListener("click", (ev) => {
          const alt = (ev as MouseEvent).altKey;
          toggle(frame.id, alt);
        });
        root.appendChild(btn);
        buttons.set(frame.id, btn);
      }

      // position OUTSIDE right edge, vertically centered
      const { x, y } = sceneCoordsToViewportCoords(
        { sceneX: frame.x + frame.width, sceneY: frame.y + frame.height / 2 },
        appState,
      );
      btn.style.left = `${x + 8}px`;
      btn.style.top = `${y - 12}px`;

      overlayEl.style.background = "rgba(255,0,0,.05)";

      const collapsed = !!(frame as any).customData?.collapsed;
      const isSelected = !!appState.selectedElementIds[frame.id];
      btn.textContent = collapsed ? "▶" : "◀"; // side arrows
      btn.title = collapsed
        ? "Expand (Alt: recursive)"
        : "Collapse (Alt: recursive)";
      btn.style.opacity = isSelected ? "1" : "0.15";
      btn.style.pointerEvents = isSelected ? "auto" : "none";
    }

    // remove buttons for frames no longer present
    for (const [id, btn] of buttons) {
      if (!frames.find((f) => f.id === id)) {
        btn.remove();
        buttons.delete(id);
      }
    }
  };

  const toggle = (frameId: string, recursive = false) => {
    toggleFrameCollapsed(api, frameId, { recursive });
    render();
  };

  // Keep hidden flags consistent on mount (import/collab)
  reconcileHiddenByFrame(api, render);

  const onCamera = () => render();
  const onScene = () => render();

  root.addEventListener("exca:camera", onCamera as EventListener);
  root.addEventListener("exca:scene", onScene as EventListener);

  render();

  return {
    root, // dispatch CustomEvents to this (exca:scene / exca:camera)
    dispose: () => {
      root.removeEventListener("exca:camera", onCamera as EventListener);
      root.removeEventListener("exca:scene", onScene as EventListener);
      for (const [, btn] of buttons) btn.remove();
      buttons.clear();
      root.remove();
    },
  };
}

// PUBLIC: reconcile once (e.g., after joining collab)
export function reconcileHiddenByFrame(
  api: ExcalidrawImperativeAPI,
  afterUpdate?: () => void,
) {
  const all = api.getSceneElementsIncludingDeleted();
  const byId: ById = new Map(all.map((e) => [e.id, e] as const));
  const hidden = computeHiddenGlobal(byId);

  let dirty = false;
  const next = applyHiddenByFrame(all, hidden);
  // detect change
  for (let i = 0; i < all.length; i++) {
    if (all[i] !== next[i]) {
      dirty = true;
      break;
    }
  }
  if (dirty) {
    api.updateScene({ elements: next });
    afterUpdate?.();
  }
}
