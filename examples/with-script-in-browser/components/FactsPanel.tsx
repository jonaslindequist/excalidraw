import { ExcalidrawElement } from "@excalidraw/element/types";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import React, { useEffect, useState } from "react";
import { useFacts, useFactsConfig } from "../facts/FactsContext";
import { FactField } from "../facts/types";

export const FactsPanel: React.FC<{
  excalidrawAPI: ExcalidrawImperativeAPI;
  elements: readonly ExcalidrawElement[];
}> = ({ excalidrawAPI, elements }) => {
  const {
    elementFacts,
    updateElementFactLink,
    updateFactSheet,
    factSheets,
    addFactSheet,
  } = useFacts();
  const { getType } = useFactsConfig();

  // pull current selection
  const { selectedElementIds } = excalidrawAPI.getAppState();
  const [selectedId] = Object.keys(selectedElementIds);

  // derive current instance ID + values
  const factSheetId = selectedId ? elementFacts[selectedId] : undefined;
  const factSheet = factSheetId ? factSheets[factSheetId] : undefined;
  const [localFacts, setLocalFacts] = useState<Record<string, any>>(
    factSheet?.values || {},
  );

  // when selection or instance changes, reset form data
  useEffect(() => {
    if (selectedId) {
      const factId = elementFacts[selectedId];
      const fact = factId ? factSheets[factId] : undefined;
      setLocalFacts(fact?.values || {});
    } else {
      setLocalFacts({});
    }
  }, [selectedId, elementFacts, factSheets]);

  if (!selectedId) {
    return <div style={{ padding: 16 }}>Select an element to see facts.</div>;
  }

  const schema = getType("microservice");
  if (!schema) {
    return <div style={{ padding: 16 }}>No schema found.</div>;
  }

  const saveField = (name: string, value: any) => {
    // update local
    const updated = { ...localFacts, [name]: value };
    setLocalFacts(updated);

    // persist
    if (factSheetId) {
      // update existing instance
      updateFactSheet(selectedId, updated);
    } else {
      // create new instance and link
      const newFactSheet = addFactSheet({ typeId: schema.id, values: updated });
      updateElementFactLink(selectedId, newFactSheet.id);
    }
  };

  const renderField = (field: FactField) => {
    const val = localFacts[field.name] ?? field.default ?? "";
    switch (field.type) {
      case "string":
      case "number":
        return (
          <input
            type={field.type}
            value={val}
            onChange={(e) =>
              saveField(
                field.name,
                field.type === "number" ? +e.target.value : e.target.value,
              )
            }
            style={{ width: "100%", marginBottom: 8 }}
          />
        );
      case "textarea":
        return (
          <textarea
            rows={3}
            value={val}
            onChange={(e) => saveField(field.name, e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          />
        );
      case "select":
        return (
          <select
            value={val}
            onChange={(e) => saveField(field.name, e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h3>{schema.label} Facts</h3>
      {schema.fields.map((field) => (
        <div key={field.name} style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: "bold" }}>{field.label}</label>
          {renderField(field)}
        </div>
      ))}
    </div>
  );
};
