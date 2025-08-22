// src/custom/facts/types.ts
export type FactField =
  | {
      id: string;
      label: string;
      type: "text";
      placeholder?: string;
      required?: boolean;
      multiline?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "select";
      options: string[];
      required?: boolean;
    }
  | { id: string; label: string; type: "url"; placeholder?: string }
  | { id: string; label: string; type: "number"; min?: number; max?: number }
  | { id: string; label: string; type: "boolean" };

export type FactEntity = {
  id: string;
  version: number;
  typeId: string; // "system" | "application" | "microservice" | ...
  values: Record<string, any>;
  tags?: string[];
  relationships?: {
    relatesTo?: string[]; // other factIds
    consumes?: string[];
    produces?: string[];
    linksToElements?: string[]; // optional: back-refs to element ids
  };
  updatedAt: number; // ms
  createdAt: number; // ms
};

export type FactStoreEvents = {
  "facts:changed": { ids: string[] }; // payload for subscriptions
};

export interface FactStore {
  get(id: string): FactEntity | null;
  list(): FactEntity[];
  put(entity: FactEntity): void; // create/update
  update(id: string, patch: Partial<FactEntity>): void;
  remove(id: string): void;

  // bulk export/import (for embedding with scene)
  exportAll(): FactEntity[];
  importMany(entities: FactEntity[], strategy?: "merge" | "overwrite"): void;

  subscribe(event: keyof FactStoreEvents, fn: (p: any) => void): () => void;
}
