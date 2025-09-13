import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type EaCD = {
  name?: string;
  factId?: string;
  expandable?: boolean;
  collapsed?: boolean;
  originalSize?: { w: number; h: number };
  __hiddenByFrame?: boolean;
};

const ensureEa = (cd: any): EaCD => cd?.ea ?? (cd.ea = {});

export const getElementName = (el: ExcalidrawElement): string | undefined => {
  // Frames may have a top-level name already
  // For other elements, prefer customData.ea.name
  const cd = (el as any).customData;
  return (el as any).name || cd?.ea?.name;
};

export const setElementName = (
  api: ExcalidrawImperativeAPI,
  id: string,
  name: string,
) => {
  const all = api.getSceneElementsIncludingDeleted();
  const next = all.map((el) => {
    if (el.id !== id) {
      return el;
    }
    const cd: any = (el as any).customData ?? {};
    const ea = ensureEa(cd);
    ea.name = name;
    return { ...el, customData: cd };
  });
  api.updateScene({ elements: next });
};

export const renameInline = (
  api: ExcalidrawImperativeAPI,
  id: string,
  onDone?: () => void,
) => {
  const el = api.getSceneElementsIncludingDeleted().find((e) => e.id === id);
  if (!el) {
    return;
  }
  const current = getElementName(el) ?? "";
  const next = window.prompt("Name", current);
  if (next != null && next.trim() !== current) {
    setElementName(api, id, next.trim());
  }
  onDone?.();
};
