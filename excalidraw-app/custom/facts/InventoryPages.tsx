// InventoryPage.tsx
import React, { useMemo, useState } from "react";
import type { FactSheetBase, FactType } from "./facts-domain";
import { useFacts } from "./FactsContext";
import { FACT_TYPE_OPTIONS } from "./FactsPanel";

type FrameRef = { id: string; title: string; path?: string };

export type InventoryPageProps = {
  frames: FrameRef[];
  onJumpToFrame?: (frameId: string) => void;

  // Attachments now live outside facts (e.g., on Excalidraw elements' customData)
  attachments?: Record<
    string, // factId
    { frameId?: string | null; elementId?: string | null }
  >;
  onAttach?: (
    factId: string,
    attachment: { frameId?: string | null; elementId?: string | null },
  ) => void;
};

export const InventoryPage: React.FC<InventoryPageProps> = ({
  frames,
  onJumpToFrame,
  attachments,
  onAttach,
}) => {
  const { facts, upsertFact, deleteFact } = useFacts();

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<FactType | "all">("all");
  const [editing, setEditing] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return facts
      .filter((f) => (typeFilter === "all" ? true : f.type === typeFilter))
      .filter((f) => {
        if (!needle) return true;
        const inTitle = f.title.toLowerCase().includes(needle);
        const inDesc = (f.description ?? "").toLowerCase().includes(needle);
        const inTags = (f.tags ?? []).some((t) =>
          t.toLowerCase().includes(needle),
        );
        const inAttrs = Object.values(f.attrs ?? {}).some((v) =>
          String(v).toLowerCase().includes(needle),
        );
        return inTitle || inDesc || inTags || inAttrs;
      })
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [facts, q, typeFilter]);

  const editingFact: FactSheetBase | null =
    facts.find((f) => f.id === editing) ?? null;

  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search facts…"
          className="border rounded-lg px-3 py-2 w-80"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as any)}
          className="border rounded-lg px-3 py-2"
        >
          <option value="all">All types</option>
          {FACT_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            const f = await upsertFact({
              title: "New Fact",
              type: "Application", // sensible default
              attrs: {},
              tags: [],
              owners: [],
              status: "draft",
            });
            setEditing(f.id);
          }}
          className="ml-auto rounded-xl px-4 py-2 border shadow-sm hover:shadow"
        >
          + New Fact
        </button>
      </div>

      {/* Table */}
      <div className="p-4 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="pb-2">Title</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Attached to</th>
              <th className="pb-2">Updated</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const attach = attachments?.[f.id];
              const frameTitle =
                attach?.frameId &&
                (frames.find((fr) => fr.id === attach.frameId)?.title ||
                  attach.frameId);
              return (
                <tr key={f.id} className="border-t">
                  <td className="py-2">
                    <button
                      className="hover:underline"
                      onClick={() => setEditing(f.id)}
                    >
                      {f.title}
                    </button>
                  </td>
                  <td className="py-2">{f.type}</td>
                  <td className="py-2">
                    {attach?.frameId ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100">
                          {frameTitle}
                        </span>
                        {onJumpToFrame && (
                          <button
                            className="text-xs underline"
                            onClick={() => onJumpToFrame(attach.frameId!)}
                          >
                            Jump
                          </button>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    {new Date(f.updatedAt).toLocaleString()}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      className="text-red-600 text-xs"
                      onClick={() => deleteFact(f.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-8">
                  No facts match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Drawer / Editor */}
      {editingFact && (
        <div
          className="fixed inset-x-0 top-16 bottom-0 z-40 bg-black/20 flex justify-end"
          onClick={() => setEditing(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-[520px] h-full bg-white shadow-xl p-5 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <input
                className="text-xl font-semibold w-full outline-none"
                value={editingFact.title}
                onChange={(e) =>
                  upsertFact({
                    id: editingFact.id,
                    title: e.target.value,
                    type: editingFact.type,
                  })
                }
              />
              <select
                className="border rounded-lg px-2 py-1"
                value={editingFact.type}
                onChange={(e) =>
                  upsertFact({
                    id: editingFact.id,
                    type: e.target.value as FactType,
                    title: editingFact.title,
                  })
                }
              >
                {FACT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Attach to frame (external binding) */}
            <div className="mt-4">
              <label className="text-xs text-gray-500">Attach to frame</label>
              <div className="flex gap-2 mt-1">
                <select
                  className="border rounded-lg px-2 py-1 w-full"
                  value={attachments?.[editingFact.id]?.frameId ?? ""}
                  onChange={(e) =>
                    onAttach?.(editingFact.id, {
                      frameId: e.target.value || null,
                      elementId:
                        attachments?.[editingFact.id]?.elementId ?? null,
                    })
                  }
                >
                  <option value="">(none)</option>
                  {frames.map((fr) => (
                    <option key={fr.id} value={fr.id}>
                      {fr.title || fr.id}
                    </option>
                  ))}
                </select>
                {attachments?.[editingFact.id]?.frameId && onJumpToFrame && (
                  <button
                    className="text-sm underline"
                    onClick={() =>
                      onJumpToFrame(attachments![editingFact.id]!.frameId!)
                    }
                  >
                    Jump
                  </button>
                )}
              </div>
            </div>

            {/* Key/Value attributes */}
            <div className="mt-6 grow overflow-auto">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Attributes</div>
                <button
                  className="text-xs underline"
                  onClick={() => {
                    const attrs = { ...(editingFact.attrs ?? {}) };
                    let k = "key";
                    let i = 1;
                    while (attrs[k]) {
                      i++;
                      k = `key${i}`;
                    }
                    attrs[k] = "";
                    upsertFact({
                      id: editingFact.id,
                      attrs,
                      title: editingFact.title,
                      type: editingFact.type,
                    });
                  }}
                >
                  + Add attribute
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {Object.entries(editingFact.attrs ?? {}).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <input
                      className="border rounded px-2 py-1 w-40"
                      value={k}
                      onChange={(e) => {
                        const next = { ...(editingFact.attrs ?? {}) };
                        const val = next[k];
                        delete next[k];
                        next[e.target.value || "key"] = val;
                        upsertFact({
                          id: editingFact.id,
                          attrs: next,
                          title: editingFact.title,
                          type: editingFact.type,
                        });
                      }}
                    />
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={String(v ?? "")}
                      onChange={(e) => {
                        const next = { ...(editingFact.attrs ?? {}) };
                        next[k] = e.target.value;
                        upsertFact({
                          id: editingFact.id,
                          attrs: next,
                          title: editingFact.title,
                          type: editingFact.type,
                        });
                      }}
                    />
                    <button
                      className="text-xs text-red-600"
                      onClick={() => {
                        const next = { ...(editingFact.attrs ?? {}) };
                        delete next[k];
                        upsertFact({
                          id: editingFact.id,
                          attrs: next,
                          title: editingFact.title,
                          type: editingFact.type,
                        });
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {Object.keys(editingFact.attrs ?? {}).length === 0 && (
                  <div className="text-xs text-gray-400">
                    No attributes yet.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 mt-auto flex justify-end">
              <button
                className="px-4 py-2 border rounded-lg"
                onClick={() => setEditing(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
