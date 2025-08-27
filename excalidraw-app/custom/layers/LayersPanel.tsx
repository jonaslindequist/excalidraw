import React, { useEffect, useMemo, useRef, useState } from "react";
import "./layers.css";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getElementName, setElementName } from "../ea/elementMeta";
import {
  revealElement,
  toggleFrameCollapsed,
} from "../expandable-frames/imperativeOverlay";

/** ----------------------------------------------------------------------------
 * Types & model
 * -------------------------------------------------------------------------- */

type Props = {
  api: ExcalidrawImperativeAPI;
  /** Pass the overlay root (overlayRootRef.current) so we can subscribe to exca:* events */
  eventTarget?: EventTarget | null;
};

type Node =
  | {
      kind: "frame";
      id: string;
      name: string;
      collapsedCanvas: boolean; // canvas collapsed state
      hiddenByFrame: boolean;
      children: Node[];
    }
  | {
      kind: "element";
      id: string;
      name: string;
      type: string;
      hiddenByFrame: boolean;
    };

enum ViewMode {
  Frames = "frames",
  FramesWithContents = "frames+contents",
  AllFlat = "all",
}

/** ----------------------------------------------------------------------------
 * Small SVG Icon set (mini icons, neutral color; CSS can tint on hover/selected)
 * -------------------------------------------------------------------------- */

const Svg: React.FC<React.SVGProps<SVGSVGElement> & { size?: number }> = ({
  size = 12,
  children,
  ...rest
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden
    focusable={false}
    style={{ display: "block" }}
    {...rest}
  >
    {children}
  </svg>
);

const stopAll = (e: React.SyntheticEvent | Event) => {
  e.stopPropagation();
};

const IconFrame = () => (
  <Svg>
    <rect
      x="4"
      y="5"
      width="16"
      height="14"
      rx="2"
      ry="2"
      fill="none"
      stroke="currentColor"
    />
  </Svg>
);
const IconRect = () => (
  <Svg>
    <rect
      x="5"
      y="6"
      width="14"
      height="12"
      rx="2"
      fill="none"
      stroke="currentColor"
    />
  </Svg>
);
const IconEllipse = () => (
  <Svg>
    <ellipse cx="12" cy="12" rx="7" ry="5" fill="none" stroke="currentColor" />
  </Svg>
);
const IconDiamond = () => (
  <Svg>
    <path d="M12 4L20 12L12 20L4 12Z" fill="none" stroke="currentColor" />
  </Svg>
);
const IconArrow = () => (
  <Svg>
    <path
      d="M5 12H17"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <path
      d="M13 8L17 12L13 16"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);
const IconLine = () => (
  <Svg>
    <path
      d="M5 17L19 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </Svg>
);
const IconDraw = () => (
  <Svg>
    <path
      d="M6 15c2.5-2.5 3.5-6.5 7-7 3-.4 4 1.5 3.5 3.5-.4 1.7-1.7 3-3.5 3.5-2 .6-3.5-.5-5 0-1 .3-1.5 1-3 3"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
    />
  </Svg>
);
const IconText = () => (
  <Svg>
    <path d="M7 7h10M12 7v10" stroke="currentColor" strokeLinecap="round" />
  </Svg>
);
const IconImage = () => (
  <Svg>
    <rect
      x="4"
      y="6"
      width="16"
      height="12"
      rx="2"
      fill="none"
      stroke="currentColor"
    />
    <circle cx="9" cy="10" r="1.5" fill="currentColor" />
    <path d="M8 16l3-3 3 2 3-3 3 3" stroke="currentColor" fill="none" />
  </Svg>
);
const IconGeneric = () => (
  <Svg>
    <rect
      x="7"
      y="7"
      width="10"
      height="10"
      rx="2"
      fill="none"
      stroke="currentColor"
    />
  </Svg>
);

const TypeIcon: React.FC<{ type: string }> = ({ type }) => {
  switch (type) {
    case "frame":
      return <IconFrame />;
    case "rectangle":
      return <IconRect />;
    case "ellipse":
      return <IconEllipse />;
    case "diamond":
      return <IconDiamond />;
    case "arrow":
      return <IconArrow />;
    case "line":
      return <IconLine />;
    case "freedraw":
      return <IconDraw />;
    case "text":
      return <IconText />;
    case "image":
      return <IconImage />;
    default:
      return <IconGeneric />;
  }
};

/** ----------------------------------------------------------------------------
 * Component
 * -------------------------------------------------------------------------- */

export function LayersPanel({ api, eventTarget }: Props) {
  const [, setTick] = useState(0);
  const [mode, setMode] = useState<ViewMode>(ViewMode.FramesWithContents);
  // UI-only folding (independent of canvas collapse)
  const [uiOpen, setUiOpen] = useState<Set<string>>(new Set());

  // Refresh on scene/camera updates
  useEffect(() => {
    if (!eventTarget) return;
    const bump = () => setTick((t) => t + 1);
    eventTarget.addEventListener("exca:scene", bump as EventListener);
    eventTarget.addEventListener("exca:camera", bump as EventListener);
    return () => {
      eventTarget.removeEventListener("exca:scene", bump as EventListener);
      eventTarget.removeEventListener("exca:camera", bump as EventListener);
    };
  }, [eventTarget]);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const all = api.getSceneElementsIncludingDeleted();
  const appState = api.getAppState();
  const selectedIds = appState.selectedElementIds;
  const theme = appState.theme;

  const tree = useMemo<Node[]>(() => {
    const byId = new Map(all.map((e) => [e.id, e] as const));
    const frames = all.filter(
      (e) => e.type === "frame",
    ) as ExcalidrawFrameElement[];
    const childrenByFrame = new Map<string, ExcalidrawElement[]>();
    for (const el of all) {
      if (el.frameId) {
        if (!childrenByFrame.has(el.frameId))
          childrenByFrame.set(el.frameId, []);
        childrenByFrame.get(el.frameId)!.push(el);
      }
    }

    const elToNode = (el: ExcalidrawElement): Node => ({
      kind: "element",
      id: el.id,
      name: getElementName(el) || el.type, // 👈 use custom name if present
      type: el.type,
      hiddenByFrame:
        !!(el as any).customData?.__hiddenByFrame || !!el.isDeleted,
    });
    const cmpIndex = (a: any, b: any) => {
      const ia = (a?.index ?? "") as string;
      const ib = (b?.index ?? "") as string;
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    };

    const frameToNode = (f: ExcalidrawFrameElement): Node => {
      const collapsedCanvas = !!(f as any).customData?.collapsed;
      const hiddenByFrame =
        !!(f as any).customData?.__hiddenByFrame || !!f.isDeleted;

      let kids: Node[] = [];
      if (mode === ViewMode.Frames || mode === ViewMode.FramesWithContents) {
        // child frames
        const childFrames = (childrenByFrame.get(f.id) ?? []).filter(
          (e) => e.type === "frame",
        ) as ExcalidrawFrameElement[];
        kids = childFrames.slice().sort(cmpIndex).map(frameToNode);

        if (mode === ViewMode.FramesWithContents) {
          const nonFrames = (childrenByFrame.get(f.id) ?? []).filter(
            (e) => e.type !== "frame",
          );
          kids.push(
            ...nonFrames
              .slice()
              .sort((a, b) => a.type.localeCompare(b.type))
              .map(elToNode),
          );
        }
      }

      return {
        kind: "frame",
        id: f.id,
        name: f.name || f.id,
        collapsedCanvas,
        hiddenByFrame,
        children: kids,
      };
    };

    if (mode === ViewMode.AllFlat) {
      // “flat”: frames at roots + top-level non-frames
      return frames
        .slice()
        .sort(cmpIndex)
        .map(frameToNode)
        .concat(
          all.filter((e) => e.type !== "frame" && !e.frameId).map(elToNode),
        );
    }

    const roots = frames.filter((f) => !f.frameId);
    return roots.slice().sort(cmpIndex).map(frameToNode);
  }, [all, mode]);

  /** Actions */
  const select = (id: string) => {
    api.updateScene({ appState: { selectedElementIds: { [id]: true } } });
  };
  const scrollTo = (id: string) => {
    const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === id);
    if (el) api.scrollToContent(el, { fitToContent: true, animate: true });
  };
  const toggleCanvasCollapse = (id: string, recursive = false) => {
    toggleFrameCollapsed(api, id, { recursive });
  };
  const reveal = (id: string) => {
    revealElement(api, id);
    select(id);
    scrollTo(id);
  };

  /** UI folding */
  const isUiOpen = (id: string) => uiOpen.has(id);
  const toggleUi = (id: string) => {
    const next = new Set(uiOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUiOpen(next);
  };
  const openAllUi = () => {
    const next = new Set<string>();
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        if (n.kind === "frame") {
          next.add(n.id);
          walk(n.children);
        }
      }
    };
    walk(tree);
    setUiOpen(next);
  };
  const closeAllUi = () => setUiOpen(new Set());

  /** Row renderer */
  const Row: React.FC<{ node: Node; depth: number }> = ({ node, depth }) => {
    const pad = 8 + depth * 14;

    if (node.kind === "frame") {
      const open = isUiOpen(node.id);
      const rowClass = [
        "layer-row",
        node.hiddenByFrame ? "is-hidden" : "",
        selectedIds[node.id] ? "is-selected" : "",
      ].join(" ");

      return (
        <div>
          <div className={rowClass} style={{ paddingLeft: pad }}>
            {/* UI fold chevron (doesn't change canvas) */}
            <button
              type="button"
              className="btn"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault(); // prevent text selection & stray drags
                toggleUi(node.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleUi(node.id);
                }
              }}
            >
              {open ? "▾" : "▶"}
            </button>

            {/* Type icon */}
            <div style={{ width: 14, display: "grid", placeItems: "center" }}>
              <TypeIcon type="frame" />
            </div>

            {/* Canvas collapse control */}
            <button
              className="btn"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const alt = (e as unknown as PointerEvent).altKey;
                toggleCanvasCollapse(node.id, alt);
              }}
              title={
                node.collapsedCanvas
                  ? "Expand on canvas (Alt: recursive)"
                  : "Collapse on canvas (Alt: recursive)"
              }
            >
              {node.collapsedCanvas ? "+" : "–"}
            </button>

            {/* Name */}
            <div
              className="name"
              title={node.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                // select on press feels snappier and avoids “no click” cases
                select(node.id);
              }}
              onDoubleClick={() => scrollTo(node.id)}
            >
              {node.name}
            </div>
          </div>

          {open &&
            node.children.map((c) => (
              <Row key={`${node.id}:${c.id}`} node={c} depth={depth + 1} />
            ))}
        </div>
      );
    }

    // Element row
    const rowClass = [
      "layer-row",
      "layer-element",
      node.hiddenByFrame ? "is-hidden" : "",
      selectedIds[node.id] ? "is-selected" : "",
    ].join(" ");

    return (
      <div className={rowClass} style={{ paddingLeft: 8 + depth * 14 + 24 }}>
        <div style={{ width: 14, display: "grid", placeItems: "center" }}>
          <TypeIcon type={node.type} />
        </div>

        <div
          className="name"
          title={`${node.type} — ${node.id}\nDouble-click to rename\nShift+Double-click to reveal & zoom`}
          onPointerDown={(e) => {
            e.stopPropagation();
            select(node.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if ((e as React.MouseEvent).shiftKey) {
              reveal(node.id);
            } else {
              // inline rename prompt (simple version)
              const el = api
                .getSceneElementsIncludingDeleted()
                .find((x) => x.id === node.id);
              if (!el) return;
              const current = getElementName(el) || "";
              const next = window.prompt("Name", current);
              if (next != null && next.trim() !== current) {
                setElementName(api, node.id, next.trim());
              }
            }
          }}
          style={{ cursor: "text", userSelect: "none" }}
        >
          {node.name}
        </div>

        <button
          className="btn"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            reveal(node.id);
          }}
          title="Reveal (expand ancestors and zoom)"
        >
          👁
        </button>
      </div>
    );
  };

  /** Render */
  return (
    <div
      className="layers-panel"
      ref={rootRef}
      data-theme={theme === "dark" ? "dark" : "light"}
      /*  onPointerDownCapture={stopAll}
      onMouseDownCapture={stopAll}
      onClickCapture={stopAll}
      onDoubleClickCapture={stopAll}
      onContextMenuCapture={stopAll}
      onKeyDownCapture={stopAll}
      onKeyUpCapture={stopAll}*/
    >
      {/* Header */}
      <div className="layers-header">
        <div className="title">Layers</div>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ViewMode)}
          style={{ marginLeft: "auto" }}
        >
          <option value={ViewMode.Frames}>Frames</option>
          <option value={ViewMode.FramesWithContents}>Frames + contents</option>
          <option value={ViewMode.AllFlat}>All (flat)</option>
        </select>
        <button className="btn" onClick={openAllUi} title="Unfold all (UI)">
          ▾▾
        </button>
        <button className="btn" onClick={closeAllUi} title="Fold all (UI)">
          ▶▶
        </button>
      </div>

      {/* Body */}
      <div className="layers-body">
        {tree.length === 0 ? (
          <div style={{ opacity: 0.7, padding: "8px" }}>No frames yet</div>
        ) : (
          tree.map((n) => <Row key={n.id} node={n} depth={0} />)
        )}
      </div>

      {/* Footer tip */}
      <div style={{ padding: "6px 8px", opacity: 0.7 }}>
        Tip: Alt-click the +/- to toggle a whole frame subtree. Double-click an
        element to reveal & zoom.
      </div>
    </div>
  );
}
