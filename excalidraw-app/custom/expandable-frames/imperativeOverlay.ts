// imperativeOverlay.ts
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/* -------------------------------------------------------------------------- */
/* Layout constants                                                           */
/* -------------------------------------------------------------------------- */
const HEADER_W = 220;
const HEADER_H = 22;

// when expanded we render header above the frame (in viewport px)
const HEADER_MARGIN_ABOVE = 6;
const CLAMP_PAD = 4; // clamp header inside center container by this many px

// collapsed frame size (header shows as a pill, frame collapsed)
export const COLLAPSED_W = HEADER_W;
export const COLLAPSED_H = HEADER_H + 10; // small “peek” under the pill

// hide the text label under this zoom (keeps UI legible when zoomed way out)
const LABEL_HIDE_ZOOM = 0.15;

// below this zoom we hide the header bar and show a tiny text label
const HEADER_HIDE_ZOOM = 0.5;

// header width computation parts (px)
const HEADER_SIDE_PAD = 8; // matches header style padding: "0 8px"
const HEADER_GAP = 6; // matches header style gap: 6px
const CHEV_W = 18; // chevron button width
const ICON_W = 14; // frame icon width
const HEADER_MIN_W = 110;
const HEADER_MAX_W = 360;
const HEADER_FONT_CSS =
  "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

// text-only label when headers are hidden
const MINI_LABEL_BASE = 14; // font size at zoom=1
const MINI_LABEL_MIN = 8;
const MINI_LABEL_MAX = 20;
const MINI_LABEL_MARGIN_ABOVE = 2; // a little closer to the frame than the header

let __measureCtx: CanvasRenderingContext2D | null = null;
const measureTextPx = (text: string, fontCss: string) => {
  if (!__measureCtx) {
    __measureCtx = document.createElement("canvas").getContext("2d");
  }
  if (!__measureCtx) return text.length * 7; // fallback
  __measureCtx.font = fontCss;
  return Math.ceil(__measureCtx.measureText(text).width);
};

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(v, max));

console.info(
  "[EA overlay] loaded from",
  (import.meta as any)?.url || "<no import.meta.url>",
);
(window as any).__EA_OVERLAY_URL__ = (import.meta as any)?.url || "unknown";

/* -------------------------------------------------------------------------- */

type ById = Map<string, ExcalidrawElement>;

const isFrame = (el: ExcalidrawElement): el is ExcalidrawFrameElement =>
  el.type === "frame";

const setStyle = (el: HTMLElement, styles: Record<string, string | number>) => {
  for (const [k, v] of Object.entries(styles)) {
    (el.style as any)[k] = typeof v === "number" ? String(v) : v;
  }
};

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

const getFrameTitle = (frame: ExcalidrawFrameElement) => {
  const cd = (frame as any).customData ?? {};
  const name = (frame.name ?? "").toString().trim();
  const title = (cd.title ?? "").toString().trim();
  // Prefer the built-in name if present; fall back to custom title, then id.
  return name || title || frame.id;
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

/* -------------------------------------------------------------------------- */
/* Public helpers                                                             */
/* -------------------------------------------------------------------------- */

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
  const { byId } = buildIndexes(all);

  const target = byId.get(elementId);
  if (!target) return;

  // collapsed ancestors to expand
  const framesToExpand: ExcalidrawFrameElement[] = [];
  let cur: ExcalidrawElement | undefined = target;
  while (cur?.frameId) {
    const parent = byId.get(cur.frameId);
    if (!parent || parent.type !== "frame") break;
    if ((parent as any).customData?.collapsed) {
      framesToExpand.push(parent as ExcalidrawFrameElement);
    }
    cur = parent;
  }

  // expand in one batch, restoring originalSize if available
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

    const hidden = computeHiddenGlobal(new Map(working.map((e) => [e.id, e])));
    working = applyHiddenByFrame(working, hidden);
    api.updateScene({ elements: working });
  }

  if (select) {
    api.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
    });
  }
  if (scroll) {
    const updatedTarget =
      api.getSceneElementsIncludingDeleted().find((e) => e.id === elementId) ??
      target;
    api.scrollToContent(updatedTarget, { animate, fitToContent });
  }
}

// collapse/expand a frame (optionally recursive)
export function toggleFrameCollapsed(
  api: ExcalidrawImperativeAPI,
  frameId: string,
  opts?: { recursive?: boolean },
) {
  const recursive = !!opts?.recursive;
  const all = api.getSceneElementsIncludingDeleted();
  const { byId, childrenByFrame } = buildIndexes(all);

  const root = byId.get(frameId);
  if (!root || root.type !== "frame") return;

  const desiredCollapsed = !(root as any).customData?.collapsed;
  const framesToToggle: ExcalidrawFrameElement[] = [root];
  if (recursive) {
    walkDescendants(root, childrenByFrame, (el) => {
      if (el.type === "frame")
        framesToToggle.push(el as ExcalidrawFrameElement);
    });
  }

  const next = all.map((el) => {
    const f = framesToToggle.find((fr) => fr.id === el.id);
    if (!f) return el;

    const prevCD: any = (f as any).customData ?? {};
    // If we're collapsing, snapshot CURRENT expanded size right now.
    // If expanding, reuse the last snapshot (or current size as fallback).
    const nextOriginalSize = desiredCollapsed
      ? { w: f.width, h: f.height }
      : prevCD.originalSize ?? { w: f.width, h: f.height };

    const width = desiredCollapsed ? COLLAPSED_W : nextOriginalSize.w;
    const height = desiredCollapsed ? COLLAPSED_H : nextOriginalSize.h;

    return {
      ...f,
      width,
      height,
      customData: {
        ...prevCD,
        expandable: true,
        collapsed: desiredCollapsed,
        originalSize: nextOriginalSize,
      },
    } as ExcalidrawElement;
  });

  const hidden = computeHiddenGlobal(new Map(next.map((e) => [e.id, e])));
  const applied = applyHiddenByFrame(next, hidden);

  api.updateScene({ elements: applied });
}

/* -------------------------------------------------------------------------- */
/* Overlay mount (headers above frames)                                       */
/* -------------------------------------------------------------------------- */

export function mountExpandableFramesOverlay(
  api: ExcalidrawImperativeAPI,
  opts?: { container?: HTMLElement; syncName?: boolean },
) {
  const headers = new Map<string, HTMLDivElement>();
  const miniLabels = new Map<string, HTMLDivElement>();
  const syncName = opts?.syncName ?? true;

  const overlayEl = document.createElement("div");
  overlayEl.setAttribute("data-exca-overlay", "frames");
  setStyle(overlayEl, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
    overflow: "hidden",
  });

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

  // tiny SVG frame icon
  const svgFrameIcon = () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.style.display = "block";
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", "4");
    rect.setAttribute("y", "6");
    rect.setAttribute("width", "16");
    rect.setAttribute("height", "12");
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "currentColor");
    svg.appendChild(rect);
    return svg;
  };

  const startInlineRename = (
    frame: ExcalidrawFrameElement,
    header: HTMLDivElement,
    label: HTMLDivElement,
  ) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = frame.name || "";
    setStyle(input, {
      flex: "1 1 auto",
      minWidth: "40px",
      font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      padding: "0",
      margin: "0",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "inherit",
    });

    const finish = (commit: boolean) => {
      if (commit) {
        const nextTitle = input.value.trim();
        const all = api.getSceneElementsIncludingDeleted();
        const next = all.map((el) => {
          if (el.id !== frame.id) return el;
          const cd = (el as any).customData ?? {};
          return {
            ...el,
            name: syncName ? nextTitle : el.customData?.name, // sync built-in name if desired
            customData: { ...cd, title: nextTitle },
          } as ExcalidrawElement;
        });
        api.updateScene({ elements: next });
      }
      label.style.display = "";
      input.remove();
      schedule();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));

    header.insertBefore(input, label);
    label.style.display = "none";
    input.focus();
    input.select();
  };

  const render = () => {
    const appState = api.getAppState();
    const elements = api.getSceneElements();
    const zoom = appState.zoom.value;

    // center container rect to convert viewport->local
    const rect = root.getBoundingClientRect();

    // theme
    const isDark = appState.theme === "dark";
    const bg = isDark ? "rgba(24,24,28,0.85)" : "rgba(255,255,255,0.9)";
    const fg = isDark ? "#e5e7eb" : "#111";
    const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)";
    const btnBg = isDark ? "#2b2f36" : "#fff";
    const btnBorder = isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)";

    const frames = elements.filter(
      (el) =>
        el.type === "frame" && (el as any).customData?.expandable === true,
    ) as ExcalidrawFrameElement[];

    for (const frame of frames) {
      const titleNow = getFrameTitle(frame);

      let header = headers.get(frame.id);
      if (!header) {
        header = document.createElement("div");
        header.setAttribute("data-exca-frame-header", titleNow);
        header.setAttribute("tabindex", "0");
        setStyle(header, {
          position: "absolute",
          height: `${HEADER_H}px`,
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 8px",
          borderRadius: "6px",
          background: bg,
          border: `1px solid ${border}`,
          boxShadow: isDark
            ? "0 1px 3px rgba(0,0,0,0.35)"
            : "0 1px 3px rgba(0,0,0,0.12)",
          font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          color: fg,
          userSelect: "none",
          WebkitUserSelect: "none",
          touchAction: "manipulation",
          minWidth: "110px",
          maxWidth: "360px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          transition: "opacity 120ms ease",
          opacity: "0.35",
        });

        // stop gestures escaping to canvas
        header.addEventListener("mousedown", (e) => e.stopPropagation());
        header.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          header!.focus();
        });
        header.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const labelEl = header!.querySelector(
            "[data-exca-frame-label]",
          ) as HTMLDivElement | null;
          if (labelEl) startInlineRename(frame, header!, labelEl);
        });
        header.addEventListener("mouseenter", () => {
          header!.style.opacity = "1";
        });
        header.addEventListener("mouseleave", () => {
          const isSelected = !!api.getAppState().selectedElementIds[frame.id];
          header!.style.opacity = isSelected ? "1" : "0.35";
        });

        const chev = document.createElement("button");
        setStyle(chev, {
          width: "18px",
          height: "18px",
          display: "grid",
          placeItems: "center",
          border: `1px solid ${btnBorder}`,
          borderRadius: "4px",
          background: btnBg,
          cursor: "pointer",
          color: fg,
        });
        chev.title = "Expand/Collapse (Alt: recursive)";
        chev.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const alt = (e as unknown as PointerEvent).altKey;
          toggle(frame.id, alt);
        });

        const iconWrap = document.createElement("span");
        setStyle(iconWrap, {
          display: "grid",
          placeItems: "center",
          opacity: "0.8",
        });
        iconWrap.appendChild(svgFrameIcon());

        const label = document.createElement("div");
        label.setAttribute("data-exca-frame-label", "");
        label.textContent = titleNow;
        setStyle(label, {
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: "1 1 auto",
          cursor: "text",
        });
        label.title = titleNow;

        label.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          api.updateScene({
            appState: { selectedElementIds: { [frame.id]: true } },
          });
          header!.style.opacity = "1";
          header!.focus();
        });
        label.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          startInlineRename(frame, header!, label);
        });

        header.addEventListener("keydown", (e) => {
          if (e.key === "F2") {
            e.preventDefault();
            e.stopPropagation();
            startInlineRename(
              frame,
              header!,
              header!.querySelector(
                "[data-exca-frame-label]",
              ) as HTMLDivElement,
            );
          } else if (e.key === "Enter") {
            api.scrollToContent(frame, { fitToContent: true, animate: true });
          }
        });

        const factsBadge = document.createElement("span");
        setStyle(factsBadge, {
          width: "8px",
          height: "8px",
          borderRadius: "999px",
          background: "#22c55e",
          marginLeft: "4px",
          display: "none",
        });

        header.appendChild(chev);
        header.appendChild(iconWrap);
        header.appendChild(label);
        header.appendChild(factsBadge);

        root.appendChild(header);
        headers.set(frame.id, header);
      }

      // dynamic updates
      const isSelected = !!appState.selectedElementIds[frame.id];
      const collapsed = !!(frame as any).customData?.collapsed;

      header.style.color = fg;
      header.style.background = bg;
      header.style.border = `1px solid ${border}`;
      header.style.boxShadow = isDark
        ? "0 1px 3px rgba(0,0,0,0.35)"
        : "0 1px 3px rgba(0,0,0,0.12)";

      // ensure data attribute & label text stay in sync with name/title
      const title = getFrameTitle(frame);
      header.setAttribute("data-exca-frame-header", title);
      const labelEl = header.querySelector(
        "[data-exca-frame-label]",
      ) as HTMLDivElement | null;
      if (labelEl && labelEl.textContent !== title) {
        labelEl.textContent = title;
        labelEl.title = title;
      }

      // frame top-left in viewport
      const tl = sceneCoordsToViewportCoords(
        { sceneX: frame.x, sceneY: frame.y },
        appState,
      );
      const leftLocal = tl.x - rect.left;
      const topLocal = tl.y - rect.top;

      // measure needed header width from title text
      const labelTextPx = measureTextPx(title, HEADER_FONT_CSS);

      // total width = chevron + gap + icon + gap + text + side paddings
      const naturalHeaderW =
        CHEV_W +
        HEADER_GAP +
        ICON_W +
        HEADER_GAP +
        labelTextPx +
        HEADER_SIDE_PAD * 2;

      const headerWidthPx = collapsed
        ? HEADER_W // keep pill size when collapsed
        : clamp(naturalHeaderW, HEADER_MIN_W, HEADER_MAX_W);

      // place ABOVE the frame (and clamp)
      const unclampedLeft = leftLocal;
      const unclampedTop = topLocal - HEADER_H - HEADER_MARGIN_ABOVE;

      const clampedLeft = clamp(
        unclampedLeft,
        CLAMP_PAD,
        rect.width - headerWidthPx - CLAMP_PAD,
      );
      const clampedTop = clamp(
        unclampedTop,
        CLAMP_PAD,
        rect.height - HEADER_H - CLAMP_PAD,
      );

      // decide which UI to show based on zoom
      const useMiniLabel = zoom < HEADER_HIDE_ZOOM;
      const showNothing = zoom < LABEL_HIDE_ZOOM;

      // ----- HEADER BAR -----
      if (!useMiniLabel && !showNothing) {
        header.style.display = "flex";
        header.style.width = `${headerWidthPx}px`;
        header.style.left = `${clampedLeft}px`;
        header.style.top = `${clampedTop}px`;
        header.style.opacity = collapsed ? "1" : isSelected ? "1" : "0.35";

        if (labelEl) labelEl.style.display = "block";
      } else {
        header.style.display = "none";
        if (labelEl) labelEl.style.display = "none";
      }

      // ----- MINI TEXT LABEL (zoomed) -----
      let mini = miniLabels.get(frame.id);
      if (!mini) {
        mini = document.createElement("div");
        miniLabels.set(frame.id, mini);
        root.appendChild(mini);
        setStyle(mini, {
          position: "absolute",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          color: fg,
          textShadow: isDark
            ? "0 1px 2px rgba(0,0,0,.75)"
            : "0 1px 2px rgba(0,0,0,.35)",
        });
      }

      // mini label content + style
      mini.textContent = title;
      const miniFontPx = clamp(
        MINI_LABEL_BASE * zoom,
        MINI_LABEL_MIN,
        MINI_LABEL_MAX,
      );
      mini.style.font = `${miniFontPx}px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      mini.style.fontWeight = isSelected ? "600" : "500";

      if (useMiniLabel && !showNothing) {
        // compute mini label width to clamp within container
        const miniW = Math.min(
          rect.width - CLAMP_PAD * 2,
          Math.max(
            40,
            measureTextPx(
              title,
              `${miniFontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`,
            ) + 2,
          ),
        );
        const miniLeft = clamp(
          leftLocal,
          CLAMP_PAD,
          rect.width - miniW - CLAMP_PAD,
        );
        const miniTop = clamp(
          topLocal - MINI_LABEL_MARGIN_ABOVE - miniFontPx,
          CLAMP_PAD,
          rect.height - miniFontPx - CLAMP_PAD,
        );
        mini.style.left = `${miniLeft}px`;
        mini.style.top = `${miniTop}px`;
        mini.style.display = "block";
      } else {
        mini.style.display = "none";
      }

      // chevron (unchanged)
      const chevBtn = header.querySelector("button")!;
      chevBtn.textContent = collapsed ? "▸" : "▾";
      chevBtn.title = collapsed
        ? "Expand (Alt: recursive)"
        : "Collapse (Alt: recursive)";

      // facts badge visibility (unchanged)
      const badge = header.querySelector("span:last-child") as HTMLSpanElement;
      const hasFacts = !!(frame as any).customData?.factId;
      badge.style.display = hasFacts ? "inline-block" : "none";
    }

    // cleanup for removed frames/labels
    for (const [id, el] of headers) {
      if (!frames.find((f) => f.id === id)) {
        el.remove();
        headers.delete(id);
      }
    }
    for (const [id, el] of miniLabels) {
      if (!frames.find((f) => f.id === id)) {
        el.remove();
        miniLabels.delete(id);
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

  const ro = new ResizeObserver(() => schedule());
  ro.observe(root);
  if (container !== root) ro.observe(container);

  // --- Heartbeat: re-render when frames (id/name/title/size/pos) or zoom/theme change
  let lastSig = "";
  const sceneSignature = () => {
    const app = api.getAppState();
    const els = api.getSceneElements();
    const frames = els.filter(
      (e) => e.type === "frame",
    ) as ExcalidrawFrameElement[];
    return [
      `z=${app.zoom.value.toFixed(3)}`,
      `th=${app.theme}`,
      ...frames.map((f) => {
        const cd: any = (f as any).customData ?? {};
        return `${f.id}:${f.name ?? ""}:${cd.title ?? ""}:${
          cd.collapsed ? 1 : 0
        }:${f.x}:${f.y}:${f.width}:${f.height}`;
      }),
    ].join("|");
  };
  const heartbeat = () => {
    const sig = sceneSignature();
    if (sig !== lastSig) {
      lastSig = sig;
      render();
    }
    requestAnimationFrame(heartbeat);
  };
  requestAnimationFrame(heartbeat);

  render();

  return {
    root, // dispatch CustomEvents here (exca:scene / exca:camera)
    dispose: () => {
      ro.disconnect();
      root.removeEventListener("exca:camera", onCamera as EventListener);
      root.removeEventListener("exca:scene", onScene as EventListener);
      for (const [, el] of headers) el.remove();
      headers.clear();
      for (const [, el] of miniLabels) el.remove();
      miniLabels.clear();
      root.remove();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reconcile (public)                                                         */
/* -------------------------------------------------------------------------- */

export function reconcileHiddenByFrame(
  api: ExcalidrawImperativeAPI,
  afterUpdate?: () => void,
) {
  const all = api.getSceneElementsIncludingDeleted();
  const byId: ById = new Map(all.map((e) => [e.id, e] as const));
  const hidden = computeHiddenGlobal(byId);

  const next = applyHiddenByFrame(all, hidden);

  let dirty = false;
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

/* -------------------------------------------------------------------------- */
/* Export helper (project titles into built-in frame names)                    */
/* -------------------------------------------------------------------------- */

export function projectFrameTitlesForExport(
  elements: readonly ExcalidrawElement[],
) {
  return elements.map((el) => {
    if (el.type !== "frame") return el;
    const cd = (el as any).customData ?? {};
    const title = cd.title ?? el.name ?? "";
    if (!title) return el;
    return { ...el, name: title } as ExcalidrawElement;
  });
}
