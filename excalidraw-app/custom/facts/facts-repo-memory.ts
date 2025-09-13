import { FactEdge, FactSheetBase } from "./facts-domain";
import { FactsRepository, FindFactsQuery, GetEdgesQuery } from "./facts-repo";

type PersistShape = {
  version: 1;
  facts: [string, FactSheetBase][];
  edges: [string, FactEdge][];
};

export class FactsRepositoryMemory implements FactsRepository {
  private facts = new Map<string, FactSheetBase>();
  private edges = new Map<string, FactEdge>();

  private storage: Storage | null;
  private storageKey: string;

  constructor(opts?: { storage?: Storage | null; storageKey?: string }) {
    this.storage =
      opts?.storage ??
      (typeof window !== "undefined" ? window.localStorage : null);
    this.storageKey = opts?.storageKey ?? "facts-repo:v1";
    this.load();
  }

  // ---- persistence ----
  private load() {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed: PersistShape = JSON.parse(raw);
      if (parsed?.version !== 1) return; // simple version gate
      this.facts = new Map(parsed.facts);
      this.edges = new Map(parsed.edges);
    } catch {
      // ignore corrupt payloads
    }
  }

  private save() {
    if (!this.storage) return;
    const payload: PersistShape = {
      version: 1,
      facts: Array.from(this.facts.entries()),
      edges: Array.from(this.edges.entries()),
    };
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // quota exceeded or private mode; optionally fall back or emit a warning
    }
  }

  // Optional: export/import helpers
  export(): PersistShape {
    return {
      version: 1,
      facts: Array.from(this.facts.entries()),
      edges: Array.from(this.edges.entries()),
    };
  }
  import(data: PersistShape) {
    if (data.version !== 1) return;
    this.facts = new Map(data.facts);
    this.edges = new Map(data.edges);
    this.save();
  }

  // ---- repo API ----
  async upsertFact(f: FactSheetBase) {
    this.facts.set(f.id, {
      ...f,
      updatedAt: Date.now(),
      createdAt: f.createdAt ?? Date.now(),
    });
    this.save();
  }

  async getFact(id: string) {
    return this.facts.get(id);
  }

  async findFacts(q: FindFactsQuery) {
    const { namespace, type, text, ids, limit = 100 } = q;
    const t = text?.toLowerCase();
    const out: FactSheetBase[] = [];
    for (const f of this.facts.values()) {
      if (f.namespace !== namespace) continue;
      if (type && f.type !== type) continue;
      if (ids && !ids.includes(f.id)) continue;
      if (t) {
        const hay =
          (f.title || "") +
          " " +
          (f.description || "") +
          " " +
          (f.tags || []).join(" ");
        if (!hay.toLowerCase().includes(t)) continue;
      }
      out.push(f);
      if (out.length >= limit) break;
    }
    out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return out;
  }

  async deleteFact(id: string) {
    this.facts.delete(id);
    // cascade edges
    for (const e of Array.from(this.edges.values())) {
      if (e.from === id || e.to === id) this.edges.delete(e.id);
    }
    this.save();
  }

  async upsertEdge(e: FactEdge) {
    this.edges.set(e.id, {
      ...e,
      updatedAt: Date.now(),
      createdAt: e.createdAt ?? Date.now(),
    });
    this.save();
  }

  async getEdges(q: GetEdgesQuery) {
    const { namespace, from, to, kind } = q;
    const out: FactEdge[] = [];
    for (const e of this.edges.values()) {
      if (e.namespace !== namespace) continue;
      if (from && e.from !== from) continue;
      if (to && e.to !== to) continue;
      if (kind && e.kind !== kind) continue;
      out.push(e);
    }
    return out;
  }

  async deleteEdge(id: string) {
    this.edges.delete(id);
    this.save();
  }
}
