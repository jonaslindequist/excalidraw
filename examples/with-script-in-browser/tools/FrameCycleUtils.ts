import { isFrameLikeElement } from "@excalidraw/element";
import { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

export const wouldCreateFrameCycle = (
  movingFrame: ExcalidrawElement,
  targetFrameId: string | null,
  elementsMap: Map<string, ExcalidrawElement>,
): boolean => {
  if (!isFrameLikeElement(movingFrame)) return false;
  if (!targetFrameId) return false;

  let currentFrameId = targetFrameId;

  while (currentFrameId) {
    if (currentFrameId === movingFrame.id) {
      // We're about to nest a frame into itself or one of its descendants
      return true;
    }

    const parent = elementsMap.get(currentFrameId);
    if (!parent || !isFrameLikeElement(parent)) {
      break;
    }

    currentFrameId = parent.frameId || null;
  }

  return false;
};
