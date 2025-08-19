import { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Eye, EyeOff } from "lucide-react"; // Optional: replace with your own icons
import { useState } from "react";

type TreeNode = {
  frame: ExcalidrawElement;
  children: ExcalidrawElement[];
  nestedFrames: TreeNode[];
};

export const SidebarStack = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const elements = excalidrawAPI.getSceneElements();

  const [expandedFrames, setExpandedFrames] = useState<Set<string>>(new Set());

  const toggleFrame = (frameId: string) => {
    const next = new Set(expandedFrames);
    next.has(frameId) ? next.delete(frameId) : next.add(frameId);
    setExpandedFrames(next);
  };

  // Build a map of elements by frameId
  const frameMap = new Map<string, ExcalidrawElement>();
  const elementsInFrame = new Map<string, ExcalidrawElement[]>();

  elements.forEach((el) => {
    if (el.type === "frame") {
      frameMap.set(el.id, el);
    }
    if (el.frameId) {
      if (!elementsInFrame.has(el.frameId)) {
        elementsInFrame.set(el.frameId, []);
      }
      elementsInFrame.get(el.frameId)!.push(el);
    }
  });

  // Build the tree recursively
  const buildTree = (frame: ExcalidrawElement): TreeNode => {
    const children = elementsInFrame.get(frame.id) || [];
    const nestedFrames = children
      .filter((el) => el.type === "frame")
      .map((el) => buildTree(el));

    const otherElements = children.filter((el) => el.type !== "frame");

    return {
      frame,
      children: otherElements,
      nestedFrames,
    };
  };

  // Top-level frames (not inside any other frame)
  const topFrames = elements
    .filter((el) => el.type === "frame" && !el.frameId)
    .map((el) => buildTree(el));

  const unframedElements = elements.filter(
    (el) => !el.frameId && el.type !== "frame",
  );

  const renderElement = (el: ExcalidrawElement) => {
    return (
      <div
        key={el.id}
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 13,
          padding: "2px 0",
          paddingLeft: 20,
        }}
      >
        <span>
          {getEmojiForType(el.type)} {el.type}
        </span>
        <span title="Visible">
          {el.customData?.isVisible ?? true ? (
            <Eye size={14} />
          ) : (
            <EyeOff size={14} />
          )}
        </span>
      </div>
    );
  };

  const renderTree = (node: TreeNode, depth: number = 0) => {
    const isOpen = expandedFrames.has(node.frame.id);
    return (
      <div
        key={node.frame.id}
        style={{ paddingLeft: depth * 12, marginBottom: 6 }}
      >
        <div
          onClick={() => toggleFrame(node.frame.id)}
          style={{
            fontWeight: "bold",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            backgroundColor: "#f5f5f5",
            padding: "4px 6px",
            borderRadius: 4,
          }}
        >
          <span>
            {isOpen ? "▾" : "▸"} {getEmojiForType("frame")}{" "}
            {node.frame.id || "Unnamed Frame"}
          </span>
          <span title="Visible">
            {node.frame.customData?.isVisible ?? true ? (
              <Eye size={14} />
            ) : (
              <EyeOff size={14} />
            )}
          </span>
        </div>

        {isOpen && (
          <div style={{ marginLeft: 8 }}>
            {node.children.map(renderElement)}
            {node.nestedFrames.map((childFrame) =>
              renderTree(childFrame, depth + 1),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: "1rem", width: 300, overflowY: "auto" }}>
      {topFrames.map((tree) => renderTree(tree))}
      {unframedElements.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ fontWeight: "bold", marginBottom: 4 }}>
            📦 Ungrouped
          </div>
          {unframedElements.map(renderElement)}
        </div>
      )}
    </div>
  );
};

const getEmojiForType = (type: ExcalidrawElement["type"]) => {
  switch (type) {
    case "rectangle":
      return "🔲";
    case "ellipse":
      return "⚪";
    case "freedraw":
      return "✏️";
    case "text":
      return "📝";
    case "line":
      return "📏";
    case "arrow":
      return "➡️";
    case "image":
      return "🖼️";
    case "frame":
      return "🗂️";
    default:
      return "";
  }
};
