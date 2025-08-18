import { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export const SidebarStack = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const elements = excalidrawAPI.getSceneElements();

  const groupMap: Record<string, ExcalidrawElement[]> = {};
  const ungrouped: ExcalidrawElement[] = [];

  elements.forEach((el) => {
    const gids = Array.isArray(el.groupIds) ? el.groupIds : [];
    if (gids.length) {
      gids.forEach((gid) => {
        if (!groupMap[gid]) groupMap[gid] = [];
        groupMap[gid].push(el);
      });
    } else {
      ungrouped.push(el);
    }
  });

  const groups = Object.entries(groupMap);

  const renderElementInfo = (el: ExcalidrawElement) => {
    return (
      <div
        key={el.id}
        style={{
          padding: "4px 6px",
          border: "1px solid #ddd",
          borderRadius: 4,
          marginBottom: 4,
          fontSize: 12,
          lineHeight: 1.3,
          backgroundColor: "#fafafa",
        }}
      >
        <div>
          <strong>
            {el.type} {getEmojiForType(el.type)}
          </strong>
        </div>
        <div>ID: {el.id.slice(0, 8)}</div>
        <div>
          Pos: ({Math.round(el.x)}, {Math.round(el.y)})
        </div>
        <div>
          Size: {Math.round(el.width)}×{Math.round(el.height)}
        </div>
        {el.frameId && <div>Frame ID: {el.frameId.slice(0, 5)}</div>}
        {el.frameId && (
          <div>
            Frame ID: <code>{el.frameId}</code>
          </div>
        )}
        <div>
          Frame ID: <code>{el.frameId ?? "null"}</code>
        </div>
        {el.groupIds.length > 0 && (
          <div>Groups: {el.groupIds.map((g) => g.slice(0, 5)).join(", ")}</div>
        )}
        <div>Visible: {String(el.customData?.isVisible ?? true)}</div>
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

  return (
    <div style={{ padding: "1rem", width: 300, overflowY: "auto" }}>
      {groups.map(([gid, members]) => (
        <div key={gid} style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            🧩 Group {gid.slice(0, 5)} ({members.length})
          </div>
          <div>{members.map(renderElementInfo)}</div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div style={{ marginTop: groups.length ? "2rem" : 0 }}>
          <div style={{ fontWeight: "bold", marginBottom: 6 }}>
            📦 Ungrouped ({ungrouped.length})
          </div>
          <div>{ungrouped.map(renderElementInfo)}</div>
        </div>
      )}

      {groups.length === 0 && ungrouped.length === 0 && (
        <p style={{ fontStyle: "italic" }}>No elements on canvas.</p>
      )}
    </div>
  );
};
