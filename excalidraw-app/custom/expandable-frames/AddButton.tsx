import { newFrameElement } from "@excalidraw/element";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export function AddExpandableFrameButton({
  api,
  defaultWidth = 700,
  defaultHeight = 320,
}: {
  api: ExcalidrawImperativeAPI | null;
  defaultWidth?: number;
  defaultHeight?: number;
}) {
  const addFrame = () => {
    if (!api) return;

    const appState = api.getAppState();
    const { width: vpW, height: vpH, offsetLeft, offsetTop } = appState;

    // Viewport center in client pixels → scene coords (handles zoom & scroll)
    const { x: cx, y: cy } = viewportCoordsToSceneCoords(
      { clientX: offsetLeft + vpW / 2, clientY: offsetTop + vpH / 2 },
      appState,
    );

    const x = Math.round(cx - defaultWidth / 2);
    const y = Math.round(cy - defaultHeight / 2);

    const frame = newFrameElement({
      x,
      y,
      width: defaultWidth,
      height: defaultHeight,
      name: "",
      backgroundColor: "#ffc9c9",
    });

    frame.name = "";

    // mark as expandable & remember expanded size for later restores
    (frame as any).customData = {
      expandable: true,
      collapsed: false,
      originalSize: { w: defaultWidth, h: defaultHeight },
      title: "Expandable Frame", // or whatever default
    };

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
