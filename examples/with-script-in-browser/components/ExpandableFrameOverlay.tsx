import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import { sceneCoordsToViewportCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useMemo, useState } from "react";

type Props = {
  api: ExcalidrawImperativeAPI | null;
};

const setDescendantVisibility = (
  frame: ExcalidrawFrameElement,
  allElements: readonly ExcalidrawElement[],
  parentVisible: boolean,
): ExcalidrawElement[] => {
  const updatedElements: ExcalidrawElement[] = [];

  const apply = (currentFrame: ExcalidrawFrameElement, visible: boolean) => {
    for (const el of allElements) {
      if (el.frameId === currentFrame.id) {
        const isFrame = el.type === "frame";
        const isCollapsed = el.customData?.collapsed === true;

        const shouldBeVisible = visible && (!isFrame || !isCollapsed);

        updatedElements.push({
          ...el,
          customData: {
            ...el.customData,
            isVisible: shouldBeVisible,
          },
        });

        if (isFrame) {
          apply(el as ExcalidrawFrameElement, shouldBeVisible);
        }
      }
    }
  };

  apply(frame, parentVisible);
  return updatedElements;
};

export function ExpandableFrameOverlay({ api }: Props) {
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(
    new Set(),
  );

  if (!api) return null;

  const appState = api.getAppState();
  const elements = api.getSceneElements();

  const frames = useMemo(
    () =>
      elements.filter(
        (el): el is ExcalidrawFrameElement =>
          el.type === "frame" && el.customData?.expandable === true,
      ),
    [elements],
  );

  const handleToggle = (frameId: string) => {
    if (!api) return;

    const allElements = api.getSceneElementsIncludingDeleted();
    console.log("All scene elements (including deleted):", allElements);

    const frame = allElements.find(
      (el) => el.id === frameId && el.type === "frame",
    ) as ExcalidrawFrameElement;

    console.log("Frame: ", frame);
    console.log("Frame name: ", frame.id);
    console.log("Frame parent: ", frame.frameId);

    if (!frame) return;

    const isCollapsed = collapsedFrames.has(frameId);

    const updatedElements = [
      {
        ...frame,
        width: isCollapsed
          ? frame.customData?.originalWidth || frame.width
          : 200,
        height: isCollapsed
          ? frame.customData?.originalHeight || frame.height
          : 100,
        customData: {
          ...frame.customData,
          collapsed: !isCollapsed,
          ...(isCollapsed
            ? {} // restoring dimensions
            : {
                originalWidth: frame.width,
                originalHeight: frame.height,
              }),
        },
      },
      ...setDescendantVisibility(frame, allElements, isCollapsed),
    ];

    const next = new Set(collapsedFrames);
    isCollapsed ? next.delete(frameId) : next.add(frameId);
    setCollapsedFrames(next);

    const mergedElements = allElements.map((el) => {
      const updated = updatedElements.find((u) => u.id === el.id);
      return updated ?? el;
    });

    api.updateScene({ elements: mergedElements });

    const al = api.getSceneElementsIncludingDeleted();
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {frames.map((frame) => {
        const { x, y } = sceneCoordsToViewportCoords(
          { sceneX: frame.x + frame.width, sceneY: frame.y },
          appState,
        );
        const left = x - appState.offsetLeft - 24;
        const top = y - appState.offsetTop + 8;
        const isCollapsed = collapsedFrames.has(frame.id);

        return (
          <button
            key={frame.id}
            onClick={() => handleToggle(frame.id)}
            title={isCollapsed ? "Expand" : "Collapse"}
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
            }}
          >
            {isCollapsed ? "+" : "-"}
          </button>
        );
      })}
    </div>
  );
}
