import { useState } from "react";
import { useFacts, useFactsConfig } from "../facts/FactsContext";
import FactSheetEditor from "./FactSheetEditor";

export default function FactSheetsManager() {
  const { factSheets, addFactSheet, deleteFactSheet } = useFacts();
  const { getTypes } = useFactsConfig();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside style={{ width: 240, borderRight: "1px solid #ccc", padding: 16 }}>
        <h2>All Sheets</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {Object.values(factSheets).map((sheet) => (
            <li key={sheet.id} style={{ marginBottom: 8 }}>
              <button
                style={{
                  background: sheet.id === selectedId ? "#eef" : "transparent",
                  width: "100%",
                  textAlign: "left",
                  padding: "4px 8px",
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() => setSelectedId(sheet.id)}
              >
                {sheet.typeId} • {sheet.id.slice(0, 5)}
              </button>
              <button
                onClick={() => {
                  deleteFactSheet(sheet.id);
                  if (selectedId === sheet.id) setSelectedId(null);
                }}
                style={{ marginLeft: 8 }}
              >
                🗑
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            // you could also navigate programmatically to a "new" subroute
            const newId = addFactSheet({
              typeId: "microservice",
              values: {},
            }).id;
            setSelectedId(newId);
          }}
        >
          + New Sheet
        </button>
      </aside>
      <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>
        {selectedId ? (
          <FactSheetEditor
            sheetId={selectedId}
            onDone={() => setSelectedId(null)}
          />
        ) : (
          <div>Select a sheet or create a new one.</div>
        )}
      </main>
    </div>
  );
}
