// ExpandableElementContext.tsx
import type { ExcalidrawElement } from "@excalidraw/element/types";
import { createContext, ReactNode, useContext, useState } from "react";

type ExpandState = {
  expanded: boolean;
  stash: ExcalidrawElement[]; // elements currently hidden (when collapsed)
};

type ExpandMap = Record<string, ExpandState>;

type Ctx = {
  state: ExpandMap;
  setExpanded: (frameId: string, expanded: boolean) => void;
  stashChildren: (frameId: string, children: ExcalidrawElement[]) => void;
  popStash: (frameId: string) => ExcalidrawElement[];
};

const ExpandCtx = createContext<Ctx | null>(null);

export const useExpandableElement = () => {
  const ctx = useContext(ExpandCtx);
  if (!ctx)
    throw new Error("useExpandableElement must be used within provider");
  return ctx;
};

export function ExpandableElementProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState<ExpandMap>({});

  const setExpanded = (frameId: string, expanded: boolean) => {
    setState((prev) => ({
      ...prev,
      [frameId]: { expanded, stash: prev[frameId]?.stash ?? [] },
    }));
  };

  const stashChildren = (frameId: string, children: ExcalidrawElement[]) => {
    setState((prev) => ({
      ...prev,
      [frameId]: { expanded: false, stash: children },
    }));
  };

  const popStash = (frameId: string) => {
    const s = state[frameId]?.stash ?? [];
    setState((prev) => ({
      ...prev,
      [frameId]: { expanded: true, stash: [] },
    }));
    return s;
    // caller will reinsert these into the scene
  };

  return (
    <ExpandCtx.Provider value={{ state, setExpanded, stashChildren, popStash }}>
      {children}
    </ExpandCtx.Provider>
  );
}
