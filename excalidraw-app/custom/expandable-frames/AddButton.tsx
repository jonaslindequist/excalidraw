import { newFrameElement } from "@excalidraw/element";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export function AddExpandableFrameButton({
  api,
  defaultWidth = 240,
  defaultHeight = 120,
}: {
  api: ExcalidrawImperativeAPI | null;
  defaultWidth?: number;
  defaultHeight?: number;
}) {
  const addFrame = () => {
    if (!api) return;
    const { width, height, offsetLeft, offsetTop, zoom } = api.getAppState();
    const x = (width / 2 - offsetLeft) / zoom.value - defaultWidth / 2;
    const y = (height / 2 - offsetTop) / zoom.value - defaultHeight / 2;

    const frame = newFrameElement({
      x,
      y,
      width: defaultWidth,
      height: defaultHeight,
      name: "Expandable",
      backgroundColor: "#ffc9c9",
    });

    const customData = {
      expandable: true,
      collapsed: false,
      originalSize: { w: defaultWidth, h: defaultHeight },
    };
    (frame as any).customData = { ...customData };
    frame.name = frame.id; // handy: show id for breadcrumbs

    const all = api.getSceneElementsIncludingDeleted();
    api.updateScene({ elements: [...all, frame] });
  };

  return (
    <button
      onClick={addFrame}
      title="Add expandable frame"
      style={{ padding: 8 }}
    >
      🧱 Expandable Frame
    </button>
  );
}
