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
  // one header <div> per frame id
  const headers = new Map<string, HTMLDivElement>();

  // overlay root inside the center container
  const overlayEl = document.createElement("div");
  overlayEl.setAttribute("data-exca-overlay", "frames");
  Object.assign(overlayEl.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none", // only children (headers) are interactive
    zIndex: "2147483647",
    overflow: "hidden", // clip to center container
  } as CSSStyleDeclaration);

  const container =
    opts?.container ??
    (document.querySelector(".dock-center") as HTMLElement) ??
    document.body;

  container.appendChild(overlayEl);
  const root = overlayEl;

  // rAF-throttled render
  let rafPending = false;
  const schedule = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  };

  const render = () => {
    const appState = api.getAppState();
    const elements = api.getSceneElements();

    // center container rect to convert viewport->local
    const rect = root.getBoundingClientRect();

    // expandable frames only
    const frames = elements.filter(
      (el) =>
        el.type === "frame" && (el as any).customData?.expandable === true,
    ) as ExcalidrawFrameElement[];

    // add/update headers
    for (const frame of frames) {
      let header = headers.get(frame.id);
      if (!header) {
        // build header container
        header = document.createElement("div");
        header.setAttribute("data-exca-frame-header", frame.id);
        Object.assign(header.style, {
          position: "absolute",
          height: "22px",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 8px",
          borderRadius: "6px",
          background: "rgba(255,255,255,0.9)",
          backdropFilter: "blur(2px)",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: "#111",
          userSelect: "none",
          WebkitUserSelect: "none",
          touchAction: "manipulation",
          // keep header visible even if frame is tiny
          minWidth: "90px",
          maxWidth: "320px",
          overflow: "hidden",
          whiteSpace: "nowrap",
        } as CSSStyleDeclaration);

        // stop gestures escaping to canvas
        header.addEventListener("mousedown", (e) => e.stopPropagation());
        header.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });

        // chevron
        const chev = document.createElement("button");
        chev.type = "button";
        Object.assign(chev.style, {
          width: "18px",
          height: "18px",
          display: "grid",
          placeItems: "center",
          border: "1px solid rgba(0,0,0,0.12)",
          borderRadius: "4px",
          background: "#fff",
          cursor: "pointer",
        } as CSSStyleDeclaration);
        chev.title = "Expand/Collapse (Alt: recursive)";
        chev.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const alt = (e as unknown as PointerEvent).altKey;
          toggle(frame.id, alt);
        });

        // type icon (simple frame glyph)
        const icon = document.createElement("span");
        icon.textContent = "▭"; // minimalist frame icon
        Object.assign(icon.style, { opacity: "0.7" } as CSSStyleDeclaration);

        // name label (click = select, double-click = scroll)
        const label = document.createElement("div");
        label.textContent = frame.name || frame.id;
        Object.assign(label.style, {
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: "1 1 auto",
          cursor: "default",
        } as CSSStyleDeclaration);
        label.title = frame.name || frame.id;
        label.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // select on press
          api.updateScene({
            appState: { selectedElementIds: { [frame.id]: true } },
          });
        });
        label.addEventListener("dblclick", () => {
          api.scrollToContent(frame, { fitToContent: true, animate: true });
        });

        header.appendChild(chev);
        header.appendChild(icon);
        header.appendChild(label);

        root.appendChild(header);
        headers.set(frame.id, header);
      }

      // keep label text current
      const name = frame.name || frame.id;
      const labelEl = header.querySelector("div");
      if (labelEl && labelEl.textContent !== name) {
        labelEl.textContent = name;
        (labelEl as HTMLDivElement).title = name;
      }

      // scene -> viewport
      const tl = sceneCoordsToViewportCoords(
        { sceneX: frame.x, sceneY: frame.y },
        appState,
      );
      // viewport -> center-local
      const leftLocal = tl.x - rect.left;
      const topLocal = tl.y - rect.top;

      // header padding inside frame
      const P_X = 8; // x padding
      const P_Y = 6; // y padding
      const headerWidth = Math.max(
        90,
        Math.min(Math.floor(frame.width - P_X * 2), 320),
      );

      header.style.left = `${leftLocal + P_X}px`;
      header.style.top = `${topLocal + P_Y}px`;
      header.style.width = `${Math.max(90, headerWidth)}px`;

      // chevron state/tooltip
      const chevBtn = header.querySelector("button")!;
      const collapsed = !!(frame as any).customData?.collapsed;
      chevBtn.textContent = collapsed ? "▸" : "▾";
      chevBtn.title = collapsed
        ? "Expand (Alt: recursive)"
        : "Collapse (Alt: recursive)";

      // visibility/affordance based on selection
      const isSelected = !!appState.selectedElementIds[frame.id];
      header.style.opacity = isSelected ? "1" : "0.35";
      // keep clickable even when not selected, but a bit subdued
      header.style.pointerEvents = "auto";
    }

    // remove headers for frames no longer present
    for (const [id, el] of headers) {
      if (!frames.find((f) => f.id === id)) {
        el.remove();
        headers.delete(id);
      }
    }
  };

  const toggle = (frameId: string, recursive = false) => {
    toggleFrameCollapsed(api, frameId, { recursive });
    schedule();
  };

  // keep hidden flags consistent on mount (import/collab)
  reconcileHiddenByFrame(api, schedule);

  const onCamera = () => schedule();
  const onScene = () => schedule();

  root.addEventListener("exca:camera", onCamera as EventListener);
  root.addEventListener("exca:scene", onScene as EventListener);

  // re-render when the center changes size (sidebars resize/toggle)
  const ro = new ResizeObserver(() => schedule());
  ro.observe(root);
  if (container !== root) ro.observe(container);

  // initial paint
  render();

  return {
    root, // dispatch CustomEvents to this (exca:scene / exca:camera)
    dispose: () => {
      ro.disconnect();
      root.removeEventListener("exca:camera", onCamera as EventListener);
      root.removeEventListener("exca:scene", onScene as EventListener);
      for (const [, el] of headers) el.remove();
      headers.clear();
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
