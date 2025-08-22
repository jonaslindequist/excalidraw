// src/custom/facts/localStore.ts
import { nanoid } from "nanoid";
import { FactEntity, FactStore } from "./types";

export type FactStoreConfig = {
  namespace: string; // e.g. scene key to avoid collisions
  storage?: Storage; // default: window.localStorage
};

const KEY = (ns: string) => `facts-db:${ns}`;

export function createLocalFactStore(cfg: FactStoreConfig): FactStore {
  const bus = new Map<string, Set<(p: any) => void>>();
  const storage = cfg.storage ?? window.localStorage;
  const ns = cfg.namespace;

  const read = (): Record<string, FactEntity> => {
    try {
      const raw = storage.getItem(KEY(ns));
      if (!raw) return {};
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };
  const write = (db: Record<string, FactEntity>) => {
    storage.setItem(KEY(ns), JSON.stringify(db));
  };
  const emit = (event: string, payload: any) => {
    const subs = bus.get(event);
    subs?.forEach((fn) => fn(payload));
  };

  return {
    get(id) {
      const db = read();
      return db[id] ?? null;
    },
    list() {
      const db = read();
      return Object.values(db).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    put(entity) {
      const db = read();
      const now = Date.now();
      const existing = db[entity.id];
      db[entity.id] = {
        ...entity,
        createdAt: existing?.createdAt ?? entity.createdAt ?? now,
        updatedAt: now,
        version: (existing?.version ?? entity.version ?? 0) + 1,
      };
      write(db);
      emit("facts:changed", { ids: [entity.id] });
    },
    update(id, patch) {
      const db = read();
      const cur = db[id];
      if (!cur) return;
      const now = Date.now();
      db[id] = {
        ...cur,
        ...patch,
        values: { ...cur.values, ...(patch as any).values },
        updatedAt: now,
        version: (cur.version ?? 0) + 1,
      };
      write(db);
      emit("facts:changed", { ids: [id] });
    },
    remove(id) {
      const db = read();
      if (!db[id]) return;
      delete db[id];
      write(db);
      emit("facts:changed", { ids: [id] });
    },
    exportAll() {
      return this.list();
    },
    importMany(entities, strategy = "merge") {
      const db = read();
      const changed: string[] = [];
      for (const e of entities) {
        if (
          strategy === "overwrite" ||
          !db[e.id] ||
          db[e.id].updatedAt < e.updatedAt
        ) {
          db[e.id] = e;
          changed.push(e.id);
        }
      }
      write(db);
      if (changed.length) emit("facts:changed", { ids: changed });
    },
    subscribe(event, fn) {
      if (!bus.has(event)) bus.set(event, new Set());
      bus.get(event)!.add(fn);
      return () => bus.get(event)!.delete(fn);
    },
  };
}

// helper to create a new entity
export function newFact(partial: Partial<FactEntity>): FactEntity {
  const now = Date.now();
  return {
    id: partial.id ?? nanoid(),
    version: partial.version ?? 1,
    typeId: partial.typeId ?? "system",
    values: partial.values ?? {},
    tags: partial.tags ?? [],
    relationships: partial.relationships ?? {},
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}
