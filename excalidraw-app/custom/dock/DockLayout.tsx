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
  onCenterReady?: (el: HTMLDivElement) => void;
};

const LS_KEY = "ea:dock-layout:v1";
const MIN_CENTER_WIDTH = 240; // keep editor usable
const HANDLE_GAP = 12; // 6px handle left + 6px handle right

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

  const rootRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);

  // expose center element to your overlay
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
    } catch {
      // ignore
    }
  }, []);

  // persist
  useEffect(() => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ leftOpen, rightOpen, leftW, rightW }),
    );
  }, [leftOpen, rightOpen, leftW, rightW]);

  const refreshEditor = useCallback(() => {
    excalidrawAPI?.refresh();
    // Fallback: Excalidraw listens to resize
    window.dispatchEvent(new Event("resize"));
  }, [excalidrawAPI]);

  // Clamp widths so center never goes below MIN_CENTER_WIDTH
  const clampWidths = useCallback(
    (nextLeft: number, nextRight: number) => {
      const root = rootRef.current;
      if (!root) return { left: nextLeft, right: nextRight };

      const total =
        root.clientWidth -
        (leftOpen ? 0 : 0) -
        (rightOpen ? 0 : 0) -
        HANDLE_GAP;

      // available width for sidebars = total - MIN_CENTER_WIDTH
      const maxSum = Math.max(0, total - MIN_CENTER_WIDTH);

      let L = leftOpen ? Math.max(minLeftWidth, nextLeft) : 0;
      let R = rightOpen ? Math.max(minRightWidth, nextRight) : 0;

      // If both open and their sum exceeds max, shrink the side being dragged later
      const sum = L + R;
      if (sum > maxSum) {
        const overflow = sum - maxSum;
        // Prefer reducing the one that was increased
        if (nextLeft !== leftW) {
          L = Math.max(minLeftWidth, L - overflow);
        } else if (nextRight !== rightW) {
          R = Math.max(minRightWidth, R - overflow);
        } else {
          // split overflow
          const half = overflow / 2;
          L = Math.max(minLeftWidth, L - half);
          R = Math.max(minRightWidth, R - half);
        }
      }
      return { left: L, right: R };
    },
    [leftOpen, rightOpen, minLeftWidth, minRightWidth, leftW, rightW],
  );

  // Re-clamp on container resize (e.g., window resize)
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver(() => {
      const { left, right } = clampWidths(leftW, rightW);
      if (left !== leftW) setLeftW(left);
      if (right !== rightW) setRightW(right);
      refreshEditor();
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampWidths, refreshEditor]);

  // pointer drag
  const draggingRef = useRef<null | {
    side: "left" | "right";
    startX: number;
    startW: number;
    pointerId: number;
  }>(null);

  const origUserSelect = useRef<string>("");

  const beginDrag = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      // only primary button / touch
      if (e.button !== 0 && e.pointerType === "mouse") return;

      const startW = side === "left" ? leftW : rightW;
      draggingRef.current = {
        side,
        startX: e.clientX,
        startW,
        pointerId: e.pointerId,
      };

      // Improve UX during drag
      origUserSelect.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      document.documentElement.style.cursor = "col-resize";

      // capture
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        const d = draggingRef.current;
        if (!d) return;

        if (d.side === "left") {
          const raw = d.startW + (ev.clientX - d.startX);
          const next = Math.max(minLeftWidth, raw);
          const { left, right } = clampWidths(next, rightW);
          setLeftW(left);
          if (right !== rightW) setRightW(right);
        } else {
          const raw = d.startW - (ev.clientX - d.startX);
          const next = Math.max(minRightWidth, raw);
          const { left, right } = clampWidths(leftW, next);
          setRightW(right);
          if (left !== leftW) setLeftW(left);
        }
      };

      const endDrag = () => {
        draggingRef.current = null;
        document.body.style.userSelect = origUserSelect.current;
        document.documentElement.style.cursor = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", endDrag);
        refreshEditor();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endDrag);
    },
    [leftW, rightW, minLeftWidth, minRightWidth, clampWidths, refreshEditor],
  );

  return (
    <div className="dock-layout" ref={rootRef}>
      {/* LEFT PANEL */}
      <div
        className="dock-sidebar left"
        data-ui
        style={{ width: leftOpen ? leftW : 0 }}
        id="dock-left"
        aria-hidden={!leftOpen}
      >
        <div className="dock-header">
          <strong>Layers</strong>
          <button
            className="dock-btn"
            onClick={() => setLeftOpen(false)}
            title="Hide"
            aria-controls="dock-left"
            aria-expanded={leftOpen}
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
        role="separator"
        aria-orientation="vertical"
        aria-controls="dock-left"
        aria-valuemin={minLeftWidth}
        aria-valuemax={10000}
        aria-valuenow={leftW}
        onPointerDown={(e) => beginDrag("left", e)}
        onDoubleClick={() => setLeftOpen((v) => !v)}
        title="Drag to resize"
      />
      {!leftOpen && (
        <button
          className="dock-rail left"
          onClick={() => setLeftOpen(true)}
          title="Show Layers"
          aria-controls="dock-left"
          aria-expanded={leftOpen}
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
          aria-controls="dock-right"
          aria-expanded={rightOpen}
        >
          ⟨
        </button>
      )}
      <div
        className="dock-handle right"
        role="separator"
        aria-orientation="vertical"
        aria-controls="dock-right"
        aria-valuemin={minRightWidth}
        aria-valuemax={10000}
        aria-valuenow={rightW}
        onPointerDown={(e) => beginDrag("right", e)}
        onDoubleClick={() => setRightOpen((v) => !v)}
        title="Drag to resize"
      />

      {/* RIGHT PANEL */}
      <div
        className="dock-sidebar right"
        data-ui
        style={{ width: rightOpen ? rightW : 0 }}
        id="dock-right"
        aria-hidden={!rightOpen}
      >
        <div className="dock-header">
          <strong>Facts</strong>
          <button
            className="dock-btn"
            onClick={() => setRightOpen(false)}
            title="Hide"
            aria-controls="dock-right"
            aria-expanded={rightOpen}
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
