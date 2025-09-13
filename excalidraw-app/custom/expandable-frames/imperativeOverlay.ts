// imperativeOverlay.ts
import {
  bumpVersion,
  sceneCoordsToViewportCoords,
} from "@excalidraw/excalidraw";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { updateElbowArrowPoints } from "../../../packages/element/src";

import {
  CLAMP_PAD,
  COLLAPSED_H,
  COLLAPSED_W,
  HEADER_H,
  HEADER_HIDE_ZOOM,
  HEADER_MARGIN_ABOVE,
  HEADER_MAX_W,
  HEADER_MIN_W,
  HEADER_W,
  LABEL_HIDE_ZOOM,
  MINI_LABEL_BASE,
  MINI_LABEL_MARGIN_ABOVE,
  MINI_LABEL_MAX,
  MINI_LABEL_MIN,
} from "./overlay-constants";
import { clamp, measureTextPx, setStyle, svgFrameIcon } from "./overlay-dom";
import {
  applyHiddenByFrame,
  buildIndexes,
  computeHiddenGlobal,
  forceRerouteElbowsForFrames,
  getFrameTitle,
  walkDescendants,
  type ById,
} from "./overlay-logic";

/* -------------------------------------------------------------------------- */
/* Public helpers                                                             */
/* -------------------------------------------------------------------------- */
const isHiddenByFrame = (el: { customData?: any }) =>
  !!el?.customData?.__hiddenByFrame;

// Move given element IDs to the end of the array (front), preserving relative order.
const collectFrameSubtreeIds = (
  rootFrameIds: string[],
  childrenByFrame: Map<string, readonly ExcalidrawElement[]>,
): string[] => {
  const out = new Set<string>();
  const stack = [...rootFrameIds];
  for (const id of stack) out.add(id);

  while (stack.length) {
    const fid = stack.pop()!;
    const kids = childrenByFrame.get(fid) ?? [];
    for (const k of kids) {
      if (!out.has(k.id)) {
        out.add(k.id);
        if (k.type === "frame") stack.push(k.id);
      }
    }
  }
  return [...out];
};

// Move given element IDs to the end (front), preserving relative order.
const bringIdsToFront = <T extends { id: string }>(
  elements: readonly T[],
  ids: string[],
): T[] => {
  if (!ids.length) return elements as T[];
  const target = new Set(ids);
  const stayed: T[] = [];
  const lifted: T[] = [];
  for (const el of elements) (target.has(el.id) ? lifted : stayed).push(el);
  return [...stayed, ...lifted];
};

export function revealElement(
  api: ExcalidrawImperativeAPI,
  elementId: string,
  opts?: {
    select?: boolean;
    scroll?: boolean;
    animate?: boolean;
    fitToContent?: boolean;
  },
) {
  const select = opts?.select ?? true;
  const scroll = opts?.scroll ?? true;
  const animate = opts?.animate ?? true;
  const fitToContent = opts?.fitToContent ?? true;

  const all = api.getSceneElementsIncludingDeleted();
  const { byId } = buildIndexes(all);

  const target = byId.get(elementId);
  if (!target) {
    return;
  }

  // expand collapsed ancestors
  const framesToExpand: ExcalidrawFrameElement[] = [];
  let cur: ExcalidrawElement | undefined = target;
  while (cur?.frameId) {
    const parent = byId.get(cur.frameId);
    if (!parent || parent.type !== "frame") {
      break;
    }
    if ((parent as any).customData?.collapsed) {
      framesToExpand.push(parent as ExcalidrawFrameElement);
    }
    cur = parent;
  }

  let working = all as ExcalidrawElement[];
  if (framesToExpand.length) {
    working = working.map((el) => {
      const isOne = framesToExpand.some((fr) => fr.id === el.id);
      if (!isOne) {
        return el;
      }

      const cd: any = (el as any).customData ?? {};
      const size = cd.originalSize ?? {
        w: (el as any).width,
        h: (el as any).height,
      };

      const prevTitle = String(cd.title ?? "").trim();
      const prevName =
        el.type === "frame" ? String((el as any).name ?? "").trim() : "";
      const stableTitle = prevTitle || prevName;

      const cdNext: any = {
        ...cd,
        expandable: true,
        collapsed: false,
        originalSize: size,
      };
      if (stableTitle) {
        cdNext.title = stableTitle;
      }

      const updated: any = {
        ...el,
        width: size.w,
        height: size.h,
        customData: cdNext,
      };
      if (el.type === "frame" && !prevName && stableTitle) {
        updated.name = stableTitle;
      }

      return updated as ExcalidrawElement;
    });

    const hidden = computeHiddenGlobal(new Map(working.map((e) => [e.id, e])));
    working = applyHiddenByFrame(working, hidden);

    const { childrenByFrame } = buildIndexes(working);
    const idsToLift = collectFrameSubtreeIds(
      framesToExpand.map((f) => f.id),
      childrenByFrame,
    );
    working = bringIdsToFront(working, idsToLift);

    api.updateScene({ elements: working });

    forceRerouteElbowsForFrames(
      api,
      framesToExpand.map((f) => f.id),
    );
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

export const rerouteElbowsTouchingFrames = (
  elements: readonly ExcalidrawElement[],
  changedFrameIds: string[],
): ExcalidrawElement[] => {
  // IMPORTANT: full map of all non-deleted elements
  const live = elements.filter((e: any) => !e.isDeleted);
  const elementsMap = new Map(live.map((e) => [e.id, e])) as any;

  const changed = new Set(changedFrameIds);
  const updates = new Map<string, ExcalidrawElement>();

  for (const el of live) {
    if (el.type !== "arrow") {
      continue;
    }
    const arrow: any = el;

    // elbow-only
    const isElbow =
      arrow.elbowed === true || (arrow.fixedSegments?.length ?? 0) > 0;
    if (!isElbow) {
      continue;
    }

    // must be bound to a changed frame
    const sb = arrow.startBinding?.elementId;
    const eb = arrow.endBinding?.elementId;
    if (!(sb && changed.has(sb)) && !(eb && changed.has(eb))) {
      continue;
    }

    // make an ephemeral copy with fixedSegments cleared so routing is unconstrained
    const ep = { ...arrow, fixedSegments: null } as any;

    // two-point update = “recompute all interior elbows”
    const start = ep.points[0];
    const end = ep.points[ep.points.length - 1];

    // Pass 1: mimic drag (snapping/heading logic like real movement)
    const dragUpd = updateElbowArrowPoints(
      ep,
      elementsMap,
      { points: [start, end] }, // do NOT pass fixedSegments here
      { isDragging: true },
    );
    const mid = { ...ep, ...dragUpd };
    elementsMap.set(arrow.id, mid); // so Pass 2 sees the latest geometry

    // Pass 2: finalize/normalize (mouseup)
    const upUpd = updateElbowArrowPoints(
      mid,
      elementsMap,
      { points: [mid.points[0], mid.points[mid.points.length - 1]] },
      { isDragging: false },
    );

    const finalArrow = bumpVersion({
      ...mid,
      ...(upUpd ?? {}),
    }) as ExcalidrawElement;
    updates.set(arrow.id, finalArrow);
  }

  return elements.map((el) => updates.get(el.id) ?? el);
};

export function toggleFrameCollapsed(
  api: ExcalidrawImperativeAPI,
  frameId: string,
  opts?: { recursive?: boolean },
) {
  const recursive = !!opts?.recursive;
  const all = api.getSceneElementsIncludingDeleted();
  const { byId, childrenByFrame } = buildIndexes(all);

  const root = byId.get(frameId);
  if (!root || root.type !== "frame") {
    return;
  }

  const desiredCollapsed = !(root as any).customData?.collapsed;
  const framesToToggle: ExcalidrawFrameElement[] = [root];
  if (recursive) {
    walkDescendants(root, childrenByFrame, (el) => {
      if (el.type === "frame") {
        framesToToggle.push(el as ExcalidrawFrameElement);
      }
    });
  }

  const next = all.map((el) => {
    const shouldToggle = framesToToggle.some((fr) => fr.id === el.id);
    if (!shouldToggle) {
      return el;
    }

    const prevCD: any = (el as any).customData ?? {};
    const nextOriginalSize = desiredCollapsed
      ? { w: (el as any).width, h: (el as any).height }
      : prevCD.originalSize ?? { w: (el as any).width, h: (el as any).height };

    const width = desiredCollapsed ? COLLAPSED_W : nextOriginalSize.w;
    const height = desiredCollapsed ? COLLAPSED_H : nextOriginalSize.h;

    const prevTitle = String(prevCD.title ?? "").trim();
    const prevName =
      el.type === "frame" ? String((el as any).name ?? "").trim() : "";
    const stableTitle = prevTitle || prevName; // ← no empty default

    const cdNext: any = {
      ...prevCD,
      expandable: true,
      collapsed: desiredCollapsed,
      originalSize: nextOriginalSize,
    };
    if (stableTitle) {
      cdNext.title = stableTitle;
    } // only set if non-empty

    const updated: any = { ...el, width, height, customData: cdNext };

    // mirror into `name` only for frames, and only if name was empty
    if (el.type === "frame" && !prevName && stableTitle) {
      updated.name = stableTitle;
    }
    return updated as ExcalidrawElement;
  });

  const hidden = computeHiddenGlobal(new Map(next.map((e) => [e.id, e])));
  const applied = applyHiddenByFrame(next, hidden);

  const rerouted = rerouteElbowsTouchingFrames(
    applied,
    framesToToggle.map((f) => f.id),
  );

  let finalElements = rerouted;
  if (!desiredCollapsed) {
    // expanding → lift whole subtree(s)
    const idsToLift = collectFrameSubtreeIds(
      framesToToggle.map((f) => f.id),
      childrenByFrame, // from buildIndexes(all)
    );
    finalElements = bringIdsToFront(rerouted, idsToLift);
  }
  api.updateScene({ elements: finalElements });

  forceRerouteElbowsForFrames(
    api,
    framesToToggle.map((f) => f.id),
  );
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
    (document.querySelector(".excalidraw") as HTMLElement) ??
    document.body;

  container.appendChild(overlayEl);
  const root = overlayEl;

  // rAF-throttled render
  let rafPending = false;
  const schedule = () => {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  };

  const startInlineRename = (
    frame: ExcalidrawFrameElement,
    header: HTMLDivElement,
    label: HTMLDivElement,
  ) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = getFrameTitle(frame);
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
        // Use current header value; if empty, fall back to existing title
        const typed = input.value.trim();
        const fallback = getFrameTitle(frame);
        const nextTitle = typed || fallback;

        const all = api.getSceneElementsIncludingDeleted();
        const next = all.map((el) => {
          if (el.id !== frame.id) {
            return el;
          }
          const cd = (el as any).customData ?? {};
          const updated: any = {
            ...el,
            customData: { ...cd, title: nextTitle },
          };
          // only frames have `name`
          if (syncName && el.type === "frame") {
            updated.name = nextTitle;
          }
          return updated as ExcalidrawElement;
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

    const rect = root.getBoundingClientRect();
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
      const hidden = isHiddenByFrame(frame);

      // If hidden-by-frame, hide existing header/mini (if any) and skip work
      if (hidden) {
        const maybeHeader = headers.get(frame.id);
        if (maybeHeader) {
          maybeHeader.style.display = "none";
        }
        const maybeMini = miniLabels.get(frame.id);
        if (maybeMini) {
          maybeMini.style.display = "none";
        }
        continue;
      }

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
          transition: "border-color 120ms ease, box-shadow 120ms ease", // ← optional niceness
          // opacity: "0.35",  // ← delete this
        });

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
          if (labelEl) {
            startInlineRename(frame, header!, labelEl);
          }
        });
        header.addEventListener("mouseenter", () => {});
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

        chev.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
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

      const selectedBorder = isDark ? "#60a5fa" : "#2563eb"; // blue-400 / blue-600
      header.style.border = isSelected
        ? `2px solid ${selectedBorder}`
        : `1px solid ${border}`;

      // subtle bump when selected (optional)
      header.style.boxShadow = isSelected
        ? isDark
          ? "0 0 0 2px rgba(96,165,250,0.25), 0 1px 3px rgba(0,0,0,0.45)"
          : "0 0 0 2px rgba(37,99,235,0.15), 0 1px 3px rgba(0,0,0,0.18)"
        : isDark
        ? "0 1px 3px rgba(0,0,0,0.35)"
        : "0 1px 3px rgba(0,0,0,0.12)";

      // keep attribute & label text in sync
      const title = getFrameTitle(frame);
      header.setAttribute("data-exca-frame-header", title);
      const labelEl = header.querySelector(
        "[data-exca-frame-label]",
      ) as HTMLDivElement | null;
      if (labelEl && labelEl.textContent !== title) {
        labelEl.textContent = title;
        labelEl.title = title;
      }

      // position + sizing
      // position + sizing
      // position + sizing
      const tl = sceneCoordsToViewportCoords(
        { sceneX: frame.x, sceneY: frame.y },
        appState,
      );
      const leftLocal = tl.x - rect.left;
      const topLocal = tl.y - rect.top;

      const useMiniLabel = zoom < HEADER_HIDE_ZOOM;
      const showNothing = zoom < LABEL_HIDE_ZOOM;

      // --- measure natural width robustly ---
      // ensure measurable without flashing
      const prevDisplay = header.style.display;
      const prevVisibility = header.style.visibility;
      header.style.display = "flex";
      header.style.visibility = "hidden";

      // remove constraints so we get the true natural width
      header.style.width = "auto";
      header.style.minWidth = "0";
      header.style.maxWidth = "none";
      if (labelEl) {
        labelEl.style.display = "block";
      }

      const natural = Math.ceil(header.scrollWidth);

      // ↓ key change: don't force the default collapsed min
      const minW = collapsed ? Math.min(HEADER_W, natural) : HEADER_MIN_W;
      const maxW = HEADER_MAX_W;
      const headerWidthPx = Math.min(Math.max(natural, minW), maxW);

      // compute clamped position
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

      // apply final constraints & show/hide
      if (!useMiniLabel && !showNothing) {
        header.style.width = `${headerWidthPx}px`; // lock width
        header.style.minWidth = `${minW}px`;
        header.style.maxWidth = `${maxW}px`;
        header.style.left = `${clampedLeft}px`;
        header.style.top = `${clampedTop}px`;
        header.style.opacity = "1";
        header.style.visibility = "visible";
      } else {
        header.style.display = "none";
        if (labelEl) {
          labelEl.style.display = "none";
        }
      }

      // mini label
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
      mini.textContent = title;
      const miniFontPx = clamp(
        MINI_LABEL_BASE * zoom,
        MINI_LABEL_MIN,
        MINI_LABEL_MAX,
      );
      mini.style.font = `${miniFontPx}px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      mini.style.fontWeight = isSelected ? "600" : "500";

      if (useMiniLabel && !showNothing) {
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

      // chevron + facts badge
      const chevBtn = header.querySelector("button")!;
      chevBtn.textContent = collapsed ? "▸" : "▾";
      chevBtn.title = collapsed
        ? "Expand (Alt: recursive)"
        : "Collapse (Alt: recursive)";
      const badge = header.querySelector("span:last-child") as HTMLSpanElement;
      const hasFacts = !!(frame as any).customData?.factId;
      badge.style.display = hasFacts ? "inline-block" : "none";
    }

    // cleanup
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

  // reconcile hidden flags on mount
  reconcileHiddenByFrame(api, schedule);

  // listen for host nudges (optional but nice)
  root.addEventListener("exca:camera", (() => schedule()) as EventListener);
  root.addEventListener("exca:scene", (() => schedule()) as EventListener);

  const ro = new ResizeObserver(() => schedule());
  ro.observe(root);
  if (container !== root) ro.observe(container);

  // heartbeat: re-render on zoom/theme/frame changes even if host forgets to nudge
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
        const hid = cd.__hiddenByFrame ? 1 : 0; // NEW
        const col = cd.collapsed ? 1 : 0;
        return `${f.id}:${f.name ?? ""}:${cd.title ?? ""}:${col}:${hid}:${
          f.x
        }:${f.y}:${f.width}:${f.height}`;
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
    root,
    dispose: () => {
      ro.disconnect();
      root.removeEventListener("exca:camera", (() => {}) as EventListener);
      root.removeEventListener("exca:scene", (() => {}) as EventListener);
      for (const [, el] of headers) {
        el.remove();
      }
      headers.clear();
      for (const [, el] of miniLabels) {
        el.remove();
      }
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
    if (el.type !== "frame") {
      return el;
    }
    const cd = (el as any).customData ?? {};
    const title = cd.title ?? el.name ?? "";
    if (!title) {
      return el;
    }
    return { ...el, name: title } as ExcalidrawElement;
  });
}
