// FactsPanel.tsx (fixed)
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import type { FactSheetBase, FactType } from "./facts-domain";
import "./facts.css";
import { useFacts } from "./FactsContext";

type Props = {
  api: ExcalidrawImperativeAPI;
  eventTarget?: EventTarget | null;
  namespace: string;
};

export function FactsPanel({ api, eventTarget, namespace }: Props) {
  // TOP-LEVEL, UNCONDITIONAL HOOKS — order must never change
  const { facts, upsertFact, updateFact, deleteFact } = useFacts();
  const [tick, setTick] = useState(0); // drives recompute on scene events
  const [activeId, setActiveId] = useState<string | null>(null); // always declared

  // bump on external "scene changed" events
  useEffect(() => {
    if (!eventTarget) return;
    const bump = () => setTick((t) => t + 1);
    eventTarget.addEventListener("exca:scene", bump as EventListener);
    return () =>
      eventTarget.removeEventListener("exca:scene", bump as EventListener);
  }, [eventTarget]);

  // compute current selection (exactly one element)
  const selected: ExcalidrawElement | null = useMemo(() => {
    const ids = Object.keys(api.getAppState().selectedElementIds);
    if (ids.length !== 1) return null;
    const el = api
      .getSceneElementsIncludingDeleted()
      .find((e) => e.id === ids[0]);
    return (el as ExcalidrawElement) ?? null;
    // depend on tick so we re-evaluate when scene changes
  }, [api, tick]);

  // figure out which facts are attached to the selected element
  const attachedIds: string[] = useMemo(() => {
    const cd = (selected as any)?.customData ?? {};
    // support single id or array
    if (Array.isArray(cd.factIds)) return cd.factIds as string[];
    if (cd.factId) return [cd.factId as string];
    return [];
  }, [selected]);

  const attachedFacts: FactSheetBase[] = useMemo(
    () => facts.filter((f) => attachedIds.includes(f.id)),
    [facts, attachedIds],
  );

  // keep activeId in sync with attachments (but never declare useState conditionally)
  useEffect(() => {
    if (attachedFacts.length === 0) {
      if (activeId !== null) setActiveId(null);
      return;
    }
    const stillAttached =
      activeId && attachedFacts.some((f) => f.id === activeId);
    if (!stillAttached) {
      setActiveId(attachedFacts[0].id);
    }
  }, [attachedFacts, activeId]);

  // helper: write back customData.factIds on the selected element
  const setAttachedOnElement = (nextIds: string[]) => {
    if (!selected) return;
    const all = api.getSceneElementsIncludingDeleted().map((el) => {
      if (el.id !== selected.id) return el;
      const prev = (el as any).customData ?? {};
      const { factId: _legacy, factIds: _old, ...rest } = prev;
      const customData =
        nextIds.length === 0 ? rest : { ...rest, factIds: nextIds };
      return { ...el, customData } as ExcalidrawElement;
    });
    api.updateScene({ elements: all });
    setTick((t) => t + 1);
  };

  const attachExisting = (id: string) => {
    const set = new Set(attachedIds);
    set.add(id);
    setAttachedOnElement([...set]);
  };

  const detachOne = (id: string) => {
    setAttachedOnElement(attachedIds.filter((x) => x !== id));
  };

  const createAndAttach = async (type: FactType, title = "Untitled") => {
    const f = await upsertFact({ type, title, namespace });
    attachExisting(f.id);
    setActiveId(f.id);
  };

  // EARLY RETURN is OK — all hooks are already called above
  if (!selected) {
    return (
      <div className="facts-panel">
        <div className="facts-head">
          <strong>Fact Sheet</strong>
        </div>
        <div className="facts-body" style={{ opacity: 0.7 }}>
          Select one element/frame to attach/edit a Fact Sheet.
        </div>
      </div>
    );
  }

  return (
    <div className="facts-panel">
      <div className="facts-head">
        <strong>Fact Sheet</strong>
        <div className="muted">Element: {selected.type}</div>
      </div>

      <div className="facts-body">
        {attachedFacts.length === 0 ? (
          <>
            <label className="facts-label">Attach Fact</label>
            <AttachFact
              allFacts={facts}
              onAttach={attachExisting}
              onCreate={createAndAttach}
            />
          </>
        ) : (
          <>
            {/* Attached list */}
            <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
              {attachedFacts.map((f) => (
                <div key={f.id} className="row" style={{ gap: 8 }}>
                  <button
                    className="link"
                    onClick={() => setActiveId(f.id)}
                    style={{
                      fontWeight: activeId === f.id ? 600 : 400,
                    }}
                  >
                    {f.title} <span style={{ opacity: 0.6 }}>· {f.type}</span>
                  </button>
                  <span style={{ opacity: 0.6 }}>#{f.id.slice(0, 6)}</span>
                  <button
                    className="muted"
                    style={{ marginLeft: "auto" }}
                    onClick={() => detachOne(f.id)}
                  >
                    Detach
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      detachOne(f.id);
                      await deleteFact(f.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            {/* Active editor */}
            {activeId && attachedFacts.some((f) => f.id === activeId) && (
              <FactEditor
                fact={attachedFacts.find((f) => f.id === activeId)!}
                onChange={(patch) => updateFact(activeId, patch)}
                onDetach={() => detachOne(activeId)}
                onDelete={async () => {
                  detachOne(activeId);
                  await deleteFact(activeId);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- helpers / subcomponents ---------------- */

function AttachFact({
  allFacts,
  onAttach,
  onCreate,
}: {
  allFacts: FactSheetBase[];
  onAttach: (id: string) => void;
  onCreate: (type: FactType, title?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<FactType>("Application");

  const list = useMemo(() => {
    const q = query.toLowerCase();
    return allFacts.filter(
      (f) => f.title.toLowerCase().includes(q) || f.id.includes(query),
    );
  }, [allFacts, query]);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <input
        className="facts-input"
        placeholder="Search existing facts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div
        style={{
          maxHeight: 180,
          overflow: "auto",
          border: "1px solid var(--divider, #e5e7eb)",
          borderRadius: 6,
        }}
      >
        {list.length === 0 ? (
          <div style={{ padding: 8, opacity: 0.6 }}>No matches</div>
        ) : (
          list.map((f) => (
            <div
              key={f.id}
              className="layer-row"
              style={{ cursor: "pointer" }}
              onClick={() => onAttach(f.id)}
              title={f.id}
            >
              <div className="name">
                {f.title} · <span style={{ opacity: 0.7 }}>{f.type}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          className="facts-input"
          value={newType}
          onChange={(e) => setNewType(e.target.value as FactType)}
        >
          {FACT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          className="facts-input"
          placeholder="Title (optional)"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <button
          onClick={() => onCreate(newType, newTitle.trim() || "Untitled")}
        >
          New Fact
        </button>
      </div>
    </div>
  );
}

function FactEditor({
  fact,
  onChange,
  onDetach,
  onDelete,
}: {
  fact: FactSheetBase;
  onChange: (
    patch: Partial<Omit<FactSheetBase, "id" | "type" | "namespace">>,
  ) => void;
  onDetach: () => void;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="facts-input"
          value={fact.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
        <span className="badge">{fact.type}</span>
      </div>

      <label className="facts-label">Description</label>
      <textarea
        className="facts-input"
        rows={4}
        value={fact.description ?? ""}
        onChange={(e) => onChange({ description: e.target.value })}
      />

      <label className="facts-label">Tags</label>
      <TagEditor
        tags={fact.tags ?? []}
        onChange={(tags) => onChange({ tags })}
      />

      {/* more fields from schema can go here */}

      <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
        <button className="muted" onClick={onDetach}>
          Detach
        </button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (t: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="facts-tags">
      <div className="tags">
        {tags.map((t) => (
          <span key={t} className="tag">
            {t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          className="facts-input"
          placeholder="Add tag…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onChange([...tags, draft.trim()]);
              setDraft("");
            }
          }}
        />
        <button
          onClick={() => {
            if (draft.trim()) {
              onChange([...tags, draft.trim()]);
              setDraft("");
            }
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* util */
export const FACT_TYPE_OPTIONS = [
  "Application",
  "Capability",
  "Process",
  "DataObject",
  "Service",
  "Platform",
  "TechComponent",
  "Vendor",
  "Initiative",
  "Objective",
  "Organization",
  "TechCategory",
] as const;
