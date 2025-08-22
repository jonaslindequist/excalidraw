// src/custom/facts/FactsPanel.tsx
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import "./facts.css";
import { createLocalFactStore, newFact } from "./localStore"; // or inject store from parent
import { FACT_TYPES, FactField } from "./registry";
import { useFactStore } from "./useFactStore";

type Props = {
  api: ExcalidrawImperativeAPI;
  eventTarget?: EventTarget | null;
  namespace: string; // scene/workspace key
};

export function FactsPanel({ api, eventTarget, namespace }: Props) {
  const store = useMemo(() => createLocalFactStore({ namespace }), [namespace]);
  const facts = useFactStore(store);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!eventTarget) return;
    const bump = () => setTick((t) => t + 1);
    eventTarget.addEventListener("exca:scene", bump as EventListener);
    return () =>
      eventTarget.removeEventListener("exca:scene", bump as EventListener);
  }, [eventTarget]);

  const selected = useMemo(() => {
    const ids = Object.keys(api.getAppState().selectedElementIds);
    if (ids.length !== 1) return null;
    return (
      (api.getSceneElementsIncludingDeleted().find((e) => e.id === ids[0]) as
        | ExcalidrawElement
        | undefined) ?? null
    );
  }, [api, api.getAppState().selectedElementIds]);

  if (!selected) return <Empty />;

  const cd = (selected as any).customData ?? {};
  const factId: string | null = cd.factId ?? null;
  const entity = facts.get(factId);

  const attachExisting = (id: string) => {
    const all = api.getSceneElementsIncludingDeleted().map((el) =>
      el.id === selected.id
        ? ({
            ...el,
            customData: { ...(el as any).customData, factId: id },
          } as ExcalidrawElement)
        : el,
    );
    api.updateScene({ elements: all });
  };

  const createAndAttach = (typeId: string) => {
    const f = newFact({ typeId });
    store.put(f);
    attachExisting(f.id);
  };

  const detach = () => {
    const all = api.getSceneElementsIncludingDeleted().map((el) => {
      if (el.id !== selected.id) return el;
      const { customData } = el as any;
      if (!customData?.factId) return el;
      const { factId: _, ...rest } = customData;
      return {
        ...el,
        customData: Object.keys(rest).length ? rest : undefined,
      } as ExcalidrawElement;
    });
    api.updateScene({ elements: all });
  };

  const updateField = (fieldId: string, value: any) => {
    if (!entity) return;
    facts.update(entity.id, { values: { ...entity.values, [fieldId]: value } });
  };

  return (
    <div className="facts-panel">
      <div className="facts-head">
        <strong>Fact Sheet</strong>
        <div className="muted">Element: {selected.type}</div>
      </div>

      <div className="facts-body">
        {!entity ? (
          <>
            <label className="facts-label">Attach Fact</label>
            <AttachFact
              list={facts.list()}
              onAttach={attachExisting}
              onCreate={createAndAttach}
            />
          </>
        ) : (
          <>
            <div className="row" style={{ alignItems: "center", gap: 8 }}>
              <strong>{entity.typeId}</strong>
              <span style={{ opacity: 0.7 }}>#{entity.id.slice(0, 6)}</span>
              <button style={{ marginLeft: "auto" }} onClick={detach}>
                Detach
              </button>
            </div>

            {/* Dynamic fields by type */}
            {FACT_TYPES.find((t) => t.id === entity.typeId)?.fields.map((f) => (
              <FieldInput
                key={f.id}
                field={f}
                value={entity.values[f.id] ?? ""}
                onChange={(v) => updateField(f.id, v)}
              />
            ))}

            {/* Quick tags */}
            <TagsEditor
              tags={entity.tags ?? []}
              onChange={(tags) => facts.update(entity.id, { tags })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Empty() {
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

function AttachFact({
  list,
  onAttach,
  onCreate,
}: {
  list: ReturnType<typeof useFactStore>["list"] extends () => infer R
    ? R
    : never;
  onAttach: (id: string) => void;
  onCreate: (typeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = list.filter(
    (f) =>
      (f.values.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
      f.id.includes(query),
  );
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
        {filtered.length === 0 ? (
          <div style={{ padding: 8, opacity: 0.6 }}>No matches</div>
        ) : (
          filtered.map((f) => (
            <div
              key={f.id}
              className="layer-row"
              style={{ cursor: "pointer" }}
              onClick={() => onAttach(f.id)}
            >
              <div className="name" title={f.id}>
                {f.values.name ?? "(unnamed)"} ·{" "}
                <span style={{ opacity: 0.7 }}>{f.typeId}</span>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="facts-input" id="new-type">
          {FACT_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const sel = (
              document.getElementById("new-type") as HTMLSelectElement
            ).value;
            onCreate(sel);
          }}
        >
          New Fact
        </button>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FactField;
  value: any;
  onChange: (v: any) => void;
}) {
  // same as before (text/select/url/number/boolean)…
  if (field.type === "text") {
    if (field.multiline) {
      return (
        <>
          <label className="facts-label">{field.label}</label>
          <textarea
            className="facts-input"
            rows={4}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      );
    }
    return (
      <>
        <label className="facts-label">{field.label}</label>
        <input
          className="facts-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </>
    );
  }
  if (field.type === "select") {
    return (
      <>
        <label className="facts-label">{field.label}</label>
        <select
          className="facts-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </>
    );
  }
  if (field.type === "url") {
    return (
      <>
        <label className="facts-label">{field.label}</label>
        <input
          className="facts-input"
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </>
    );
  }
  if (field.type === "number") {
    return (
      <>
        <label className="facts-label">{field.label}</label>
        <input
          className="facts-input"
          type="number"
          value={value}
          onChange={(e) =>
            onChange(e.target.value === "" ? "" : Number(e.target.value))
          }
        />
      </>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="facts-checkbox">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    );
  }
  return null;
}

function TagsEditor({
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
