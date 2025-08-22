import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { FactsPanel } from "../facts/FactsPanel";
import { LayersPanel } from "../layers/LayersPanel";
import "./dock-layout.css";

type Props = {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  overlayEventTarget: EventTarget | null; // overlayRootRef.current
  factsNamespace: string;
  children: React.ReactNode; // your <Excalidraw> goes here
  defaultLeftWidth?: number; // px
  defaultRightWidth?: number; // px
  minLeftWidth?: number;
  minRightWidth?: number;
  onCenterReady?: (el: HTMLDivElement) => void; // NEW
};

const LS_KEY = "ea:dock-layout:v1";

export function DockLayout({
  excalidrawAPI,
  overlayEventTarget,
  factsNamespace,
  onCenterReady,
  children,
  defaultLeftWidth = 280,
  defaultRightWidth = 320,
  minLeftWidth = 220,
  minRightWidth = 260,
}: Props) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftW, setLeftW] = useState(defaultLeftWidth);
  const [rightW, setRightW] = useState(defaultRightWidth);
  const centerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (centerRef.current && onCenterReady) onCenterReady(centerRef.current);
  }, [onCenterReady]);

  // restore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.leftOpen === "boolean") setLeftOpen(s.leftOpen);
      if (typeof s.rightOpen === "boolean") setRightOpen(s.rightOpen);
      if (typeof s.leftW === "number") setLeftW(s.leftW);
      if (typeof s.rightW === "number") setRightW(s.rightW);
    } catch {}
  }, []);

  // persist
  useEffect(() => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ leftOpen, rightOpen, leftW, rightW }),
    );
  }, [leftOpen, rightOpen, leftW, rightW]);

  // Ask Excalidraw to recompute the canvas when layout changes
  const refreshEditor = useCallback(() => {
    excalidrawAPI?.refresh();
    // As a fallback, trigger a resize event (Excalidraw also listens to it)
    window.dispatchEvent(new Event("resize"));
  }, [excalidrawAPI]);

  useEffect(() => {
    refreshEditor();
  }, [leftOpen, rightOpen, leftW, rightW, refreshEditor]);

  // drag handles
  const draggingRef = useRef<null | {
    side: "left" | "right";
    startX: number;
    startW: number;
  }>(null);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      if (d.side === "left") {
        const next = Math.max(minLeftWidth, d.startW + (e.clientX - d.startX));
        setLeftW(next);
      } else {
        const next = Math.max(minRightWidth, d.startW - (e.clientX - d.startX));
        setRightW(next);
      }
    },
    [minLeftWidth, minRightWidth],
  );

  const onMouseUp = useCallback(() => {
    draggingRef.current = null;
    refreshEditor();
  }, [refreshEditor]);

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startDrag = (side: "left" | "right", e: React.MouseEvent) => {
    draggingRef.current = {
      side,
      startX: e.clientX,
      startW: side === "left" ? leftW : rightW,
    };
    e.preventDefault();
  };

  return (
    <div className="dock-layout">
      {/* LEFT PANEL */}
      <div
        className="dock-sidebar left"
        style={{ width: leftOpen ? leftW : 0 }}
      >
        <div className="dock-header">
          <strong>Layers</strong>
          <button
            className="dock-btn"
            onClick={() => setLeftOpen(false)}
            title="Hide"
          >
            ⟨
          </button>
        </div>
        {leftOpen && excalidrawAPI && (
          <LayersPanel api={excalidrawAPI} eventTarget={overlayEventTarget} />
        )}
      </div>

      {/* LEFT HANDLE / RAIL */}
      <div
        className="dock-handle left"
        onMouseDown={(e) => startDrag("left", e)}
        title="Drag to resize"
      />
      {!leftOpen && (
        <button
          className="dock-rail left"
          onClick={() => setLeftOpen(true)}
          title="Show Layers"
        >
          ⟩
        </button>
      )}

      {/* CENTER EDITOR */}
      <div className="dock-center" ref={centerRef}>
        {children}
      </div>

      {/* RIGHT HANDLE / RAIL */}
      {!rightOpen && (
        <button
          className="dock-rail right"
          onClick={() => setRightOpen(true)}
          title="Show Facts"
        >
          ⟨
        </button>
      )}
      <div
        className="dock-handle right"
        onMouseDown={(e) => startDrag("right", e)}
        title="Drag to resize"
      />

      {/* RIGHT PANEL */}
      <div
        className="dock-sidebar right"
        style={{ width: rightOpen ? rightW : 0 }}
      >
        <div className="dock-header">
          <strong>Facts</strong>
          <button
            className="dock-btn"
            onClick={() => setRightOpen(false)}
            title="Hide"
          >
            ⟩
          </button>
        </div>
        {rightOpen && excalidrawAPI && (
          <FactsPanel
            api={excalidrawAPI}
            eventTarget={overlayEventTarget}
            namespace={factsNamespace}
          />
        )}
      </div>
    </div>
  );
}
