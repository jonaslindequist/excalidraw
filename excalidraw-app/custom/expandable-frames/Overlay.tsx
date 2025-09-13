import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";

import { useMemo } from "react";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  FractionalIndex,
} from "@excalidraw/element/types";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  buildIndexes,
  collectArrowsTouching,
  isFrame,
  setHiddenByFrame,
  walkDescendants,
} from "./helpers";

export function ExpandableFrameOverlay({
  api,
}: {
  api: ExcalidrawImperativeAPI | null;
}) {
  if (!api) {
    return null;
  }

  const appState = api.getAppState();
  const elements = api.getSceneElements();

  // Helper: take any element with possibly-null index and make it non-null
  type Ordered<T extends { index: FractionalIndex | null }> = Omit<
    T,
    "index"
  > & {
    index: FractionalIndex;
  };

  type OrderedFrame = Ordered<ExcalidrawFrameElement>;
  type OrderedElement = Ordered<ExcalidrawElement>; // handy alias for parameters

  function isExpandableFrame(el: OrderedElement): el is OrderedFrame {
    return el.type === "frame" && (el as any).customData?.expandable === true;
  }

  // discover only our “expandable” frames
  const frames = useMemo(() => elements.filter(isExpandableFrame), [elements]);

  const toggleFrame = (frameId: string) => {
    const all = api.getSceneElementsIncludingDeleted();
    const { byId, childrenByFrame } = buildIndexes(all);
    const frame = byId.get(frameId) as ExcalidrawFrameElement | undefined;
    if (!frame || !isFrame(frame)) {
      return;
    }

    // Persisted collapsed flag
    const wasCollapsed = !!(frame as any).customData?.collapsed;
    const willCollapse = !wasCollapsed;

    // Remember size once
    const originalSize = (frame as any).customData?.originalSize ?? {
      w: frame.width,
      h: frame.height,
    };

    // Collect descendants to hide/show
    const toToggle = new Set<string>();
    walkDescendants(frame, childrenByFrame, (el) => {
      toToggle.add(el.id);
    });

    // Also toggle any connectors that touch descendants
    const arrowsTouching = collectArrowsTouching(all, toToggle);
    arrowsTouching.forEach((id) => toToggle.add(id));

    // Apply element mutations
    const updated = all.map((el) => {
      if (el.id === frame.id) {
        return {
          ...el,
          width: willCollapse ? 200 : originalSize.w,
          height: willCollapse ? 100 : originalSize.h,
          customData: {
            ...(el as any).customData,
            expandable: true,
            collapsed: willCollapse,
            originalSize, // always keep original
          },
        } as ExcalidrawElement;
      }
      return el;
    });

    // Now hide/show descendants by flipping isDeleted (tagged as ours)
    const nextElements = setHiddenByFrame(
      updated,
      willCollapse ? toToggle : new Set(),
    );

    api.updateScene({ elements: nextElements });
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9_999,
      }}
    >
      {frames.map((frame) => {
        const { x, y } = sceneCoordsToViewportCoords(
          { sceneX: frame.x + frame.width, sceneY: frame.y },
          appState,
        );
        const left = x - 24; // ← no offset subtraction
        const top = y + 8;

        const collapsed = !!(frame as any).customData?.collapsed;

        return (
          <button
            key={frame.id}
            onClick={() => toggleFrame(frame.id)}
            title={collapsed ? "Expand" : "Collapse"}
            style={{
              position: "absolute",
              left,
              top,
              width: 24,
              height: 24,
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#fff",
              pointerEvents: "auto",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
              cursor: "pointer",
              userSelect: "none",
              zIndex: 2147483647,
            }}
          >
            {collapsed ? "+" : "–"}
          </button>
        );
      })}
    </div>
  );
}
