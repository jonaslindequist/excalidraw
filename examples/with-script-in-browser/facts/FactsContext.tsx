// src/context/FactsContext.tsx
import React, { createContext, ReactNode, useContext, useState } from "react";
import { FactSheet, FactSheetStore, FactType, factTypes } from "./types";

export interface FactsContextShape {
  elementFacts: Record<string, FactSheet["id"] | null>;
  updateElementFactLink: (elementId: string, instanceId: string | null) => void;

  factSheets: FactSheetStore;
  addFactSheet: (
    inst: Omit<FactSheet, "id" | "createdAt" | "updatedAt">,
  ) => FactSheet;
  updateFactSheet: (id: string, values: Partial<FactSheet["values"]>) => void;
  deleteFactSheet: (id: string) => void;

  getTypes: () => FactType[];
  getType: (id: string) => FactType | undefined;
}

const FactsContext = createContext<FactsContextShape | null>(null);

export const useFacts = () => {
  const ctx = useContext(FactsContext);
  if (!ctx) {
    throw new Error("useFacts must be used within FactsProvider");
  }
  return {
    elementFacts: ctx.elementFacts,
    updateElementFactLink: ctx.updateElementFactLink,
    factSheets: ctx.factSheets,
    addFactSheet: ctx.addFactSheet,
    updateFactSheet: ctx.updateFactSheet,
    deleteFactSheet: ctx.deleteFactSheet,
  };
};

export const useFactsConfig = () => {
  const ctx = useContext(FactsContext);
  if (!ctx) {
    throw new Error("useFactsConfig must be used within FactsProvider");
  }
  return {
    getTypes: ctx.getTypes,
    getType: ctx.getType,
  };
};

// Annotate as React.FC so TS expects a ReactNode return
export const FactsProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  // element→sheet links
  const [elementFacts, setElementFacts] = useState<
    Record<string, FactSheet["id"] | null>
  >({});
  const updateElementFactLink = (
    elementId: string,
    instanceId: string | null,
  ) => {
    setElementFacts((prev) => ({ ...prev, [elementId]: instanceId }));
  };

  // standalone sheet instances
  const [factSheets, setFactSheets] = useState<FactSheetStore>({});
  const addFactSheet = (
    inst: Omit<FactSheet, "id" | "createdAt" | "updatedAt">,
  ): FactSheet => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const sheet: FactSheet = { ...inst, id, createdAt: now, updatedAt: now };
    setFactSheets((prev) => ({
      ...prev,
      [id]: sheet,
    }));
    return sheet;
  };
  const updateFactSheet = (
    id: string,
    values: Partial<FactSheet["values"]>,
  ) => {
    setFactSheets((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        values: { ...prev[id].values, ...values },
        updatedAt: Date.now(),
      },
    }));
  };
  const deleteFactSheet = (id: string) => {
    setFactSheets((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  // schema registry
  const getTypes = () => factTypes;
  const getType = (typeId: string) => factTypes.find((t) => t.id === typeId);

  // **Single return of valid JSX**—no stray braces or code after this
  return (
    <FactsContext.Provider
      value={{
        elementFacts,
        updateElementFactLink,
        factSheets,
        addFactSheet,
        updateFactSheet,
        deleteFactSheet,
        getTypes,
        getType,
      }}
    >
      {children}
    </FactsContext.Provider>
  );
};
