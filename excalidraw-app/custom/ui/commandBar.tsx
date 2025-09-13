import React, { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyPlan } from "../ai/applyPlan";
import { generatePlanMock, type AiContext } from "../ai/mockClient";
import { PlanSchema, type Plan } from "../ai/schemas";
import { FactsStore } from "../ai/store";

type Props = { api: ExcalidrawImperativeAPI | null };

type Mode = "prompt" | "plan";

const LS_PLAN_KEY = "commandbar.lastPlanText";

function stripLineComments(s: string) {
  return s
    .split("\n")
    .map((line) => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");
}

export const CommandBar: React.FC<Props> = ({ api }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastPlan, setLastPlan] = useState<Plan | null>(null);
  const [mode, setMode] = useState<Mode>("prompt");

  const inputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  const [planText, setPlanText] = useState<string>(() => {
    return (
      localStorage.getItem(LS_PLAN_KEY) ||
      `{
  // Paste a plan JSON object with a "plan" array.
  "plan": []
}`
    );
  });

  useEffect(() => {
    localStorage.setItem(LS_PLAN_KEY, planText);
  }, [planText]);

  const ctx = useMemo<AiContext>(() => {
    if (!api) {
      return {
        viewport: { center: [0, 0], zoom: 1 },
        selection: { ids: [] },
        frames: [],
        elements: [],
        facts: FactsStore.all(),
      };
    }
    const app = api.getAppState();
    const els = api.getSceneElementsIncludingDeleted() as any[];
    const frames = els
      .filter((e) => e.type === "frame")
      .map((f) => ({
        id: f.id,
        title: f.customData?.title ?? f.name ?? "",
        collapsed: !!f.customData?.collapsed,
      }));
    const elements = els.map((e) => ({
      id: e.id,
      type: e.type,
      frameId: e.frameId ?? null,
      title: e.customData?.title ?? e.name ?? "",
    }));
    const cx = (app.width / 2 - app.offsetLeft) / app.zoom.value;
    const cy = (app.height / 2 - app.offsetTop) / app.zoom.value;
    return {
      viewport: { center: [cx, cy], zoom: app.zoom.value },
      selection: { ids: Object.keys(app.selectedElementIds) },
      focusedFrameId:
        frames.find((f) => app.selectedElementIds[f.id])?.id ?? null,
      frames,
      elements,
      facts: FactsStore.all(),
    };
  }, [api?.getAppState(), api?.getSceneElementsIncludingDeleted()]);

  const runPrompt = async () => {
    if (!api) {
      return;
    }
    const q = inputRef.current?.value?.trim() ?? "";
    if (!q) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const raw = await generatePlanMock(q, ctx);
      const parsed = PlanSchema.parse(raw);
      setLastPlan(parsed);
      await applyPlan(api, parsed);
      inputRef.current!.value = "";
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  };

  const runPlan = async () => {
    if (!api) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const cleaned = stripLineComments(planText);
      const parsed = PlanSchema.parse(JSON.parse(cleaned));
      setLastPlan(parsed);
      await applyPlan(api, parsed);
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to parse/execute plan");
    } finally {
      setBusy(false);
    }
  };

  const onKeyDownPrompt = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runPrompt();
    }
  };
  const onKeyDownPlan = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runPlan();
    }
  };

  return (
    <>
      {/* Toggle button */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#fff",
          }}
        >
          ⌘K Command
        </button>
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: "50%",
            transform: "translateX(-50%)",
            width: 640,
            maxWidth: "92vw",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,.12)",
            background: "#fff",
            padding: 10,
            zIndex: 20,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Tabs */}
          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 8,
              borderBottom: "1px solid #eef2f7",
              paddingBottom: 6,
            }}
          >
            <button
              onClick={() => setMode("prompt")}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: mode === "prompt" ? "#eef2ff" : "#fff",
                fontWeight: 500,
              }}
            >
              Prompt
            </button>
            <button
              onClick={() => setMode("plan")}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: mode === "plan" ? "#eef2ff" : "#fff",
                fontWeight: 500,
              }}
            >
              Plan (JSON)
            </button>
            <div style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
              Tip: Cmd/Ctrl+Enter to run
            </div>
          </div>

          {/* Prompt mode */}
          {mode === "prompt" && (
            <>
              <input
                ref={inputRef}
                placeholder='e.g. "Add a Payments domain with two services"'
                onKeyDown={onKeyDownPrompt}
                autoFocus
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  outline: "none",
                  fontSize: 14,
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  alignItems: "center",
                }}
              >
                <button
                  onClick={runPrompt}
                  disabled={busy}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    background: busy ? "#f3f4f6" : "#fff",
                  }}
                >
                  {busy ? "Thinking…" : "Run"}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #eee",
                  }}
                >
                  Close
                </button>
                {err && (
                  <div style={{ color: "#b91c1c", marginLeft: "auto" }}>
                    Error: {err}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Plan mode */}
          {mode === "plan" && (
            <>
              <textarea
                ref={textAreaRef}
                value={planText}
                onChange={(e) => setPlanText(e.target.value)}
                onKeyDown={onKeyDownPlan}
                spellCheck={false}
                placeholder='Paste a JSON plan with a "plan" array…'
                style={{
                  width: "100%",
                  height: 260,
                  resize: "vertical",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  outline: "none",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 13,
                  background: "#fafafa",
                }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  alignItems: "center",
                }}
              >
                <button
                  onClick={runPlan}
                  disabled={busy}
                  title="Cmd/Ctrl+Enter"
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    background: busy ? "#f3f4f6" : "#fff",
                  }}
                >
                  {busy ? "Running…" : "Run plan"}
                </button>
                <button
                  onClick={() =>
                    setPlanText((t) => {
                      try {
                        const obj = JSON.parse(stripLineComments(t));
                        return JSON.stringify(obj, null, 2);
                      } catch {
                        return t;
                      }
                    })
                  }
                  disabled={busy}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #ddd",
                    background: "#fff",
                  }}
                >
                  Format
                </button>
                <button
                  onClick={() =>
                    setPlanText(`{
  "plan": []
}`)
                  }
                  disabled={busy}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #eee",
                    background: "#fff",
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setOpen(false)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid #eee",
                    marginLeft: "auto",
                  }}
                >
                  Close
                </button>
                {err && (
                  <div style={{ color: "#b91c1c", marginLeft: 8 }}>
                    Error: {err}
                  </div>
                )}
              </div>

              {lastPlan && (
                <pre
                  style={{
                    marginTop: 8,
                    background: "#f9fafb",
                    border: "1px solid #eef2f7",
                    borderRadius: 8,
                    padding: 8,
                    maxHeight: 220,
                    overflow: "auto",
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(lastPlan, null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};
