// AddExpandableFrameButton.tsx (your toolbar button)
import { newFrameElement } from "@excalidraw/element";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

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
      backgroundColor: "#ffc9c9",
      width: defaultWidth,
      height: defaultHeight,
      name: "Expandable",
      customData: { expandable: true, expanded: true },
    });
    frame.name = frame.id;

    const allElements = api.getSceneElementsIncludingDeleted();

    api.updateScene({ elements: [...allElements, frame] });
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
