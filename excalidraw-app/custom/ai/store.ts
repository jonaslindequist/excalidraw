export type Fact = { id: string; kind: string; attrs: Record<string, any> };

// trivial in-memory store (swap with your backend later)
const facts = new Map<string, Fact>();

const newId = () => "fact_" + Math.random().toString(36).slice(2, 10);

export const FactsStore = {
  all(): Fact[] {
    return Array.from(facts.values());
  },
  get(id: string) {
    return facts.get(id) || null;
  },
  ensure(kind: string, attrs: Record<string, any>, idHint?: string): Fact {
    // super naive dedupe: by exact attrs JSON
    const key = JSON.stringify({ kind, attrs });
    for (const f of facts.values()) {
      if (
        f.kind === kind &&
        JSON.stringify(f.attrs) === JSON.stringify(attrs)
      ) {
        return f;
      }
    }
    const id = idHint ? `fact_${idHint}` : newId();
    const rec = { id, kind, attrs };
    facts.set(id, rec);
    return rec;
  },
  findByMatch(kind: string, match?: Record<string, any>): Fact | null {
    for (const f of facts.values()) {
      if (f.kind !== kind) continue;
      if (!match) return f;
      let ok = true;
      for (const [k, v] of Object.entries(match)) {
        if (f.attrs?.[k] !== v) {
          ok = false;
          break;
        }
      }
      if (ok) return f;
    }
    return null;
  },
};
