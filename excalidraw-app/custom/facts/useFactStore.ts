// src/custom/facts/useFactStore.ts
import { useEffect, useState } from "react";

import type { FactEntity, FactStore } from "./types";

export function useFactStore(store: FactStore) {
  const [, setTick] = useState(0);
  useEffect(
    () => store.subscribe("facts:changed", () => setTick((t) => t + 1)),
    [store],
  );
  return {
    get: (id: string | null | undefined) => (id ? store.get(id) : null),
    list: () => store.list(),
    put: (e: FactEntity) => store.put(e),
    update: (id: string, patch: Partial<FactEntity>) => store.update(id, patch),
    remove: (id: string) => store.remove(id),
    exportAll: () => store.exportAll(),
    importMany: (arr: FactEntity[], strategy?: "merge" | "overwrite") =>
      store.importMany(arr, strategy),
  };
}
