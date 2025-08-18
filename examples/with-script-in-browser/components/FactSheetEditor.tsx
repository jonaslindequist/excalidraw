// src/components/FactSheetEditor.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFacts, useFactsConfig } from "../facts/FactsContext";
import { FactField, FactSheet, FactType } from "../facts/types";

interface Props {
  sheetId: string;
  onDone?: () => void;
}

export default function FactSheetEditor({ sheetId, onDone }: Props) {
  const navigate = useNavigate();
  const { factSheets, updateFactSheet, deleteFactSheet } = useFacts();
  const { getType } = useFactsConfig();

  // find our sheet
  const sheet: FactSheet | undefined = factSheets[sheetId];
  if (!sheet) {
    return <p>⚠️ Sheet not found.</p>;
  }

  // lookup schema
  const schema: FactType | undefined = getType(sheet.typeId);
  if (!schema) {
    return <p>⚠️ Schema “{sheet.typeId}” not registered.</p>;
  }

  // local form state
  const [values, setValues] = useState<Record<string, any>>(sheet.values);

  // keep local in sync if sheet changes externally
  useEffect(() => {
    setValues(sheet.values);
  }, [sheet.values]);

  function saveField(name: string, val: any) {
    const next = { ...values, [name]: val };
    setValues(next);
    updateFactSheet(sheetId, { [name]: val });
  }

  function renderField(field: FactField) {
    const v = values[field.name] ?? field.default ?? "";
    switch (field.type) {
      case "string":
      case "number":
        return (
          <input
            type={field.type}
            value={v}
            onChange={(e) =>
              saveField(
                field.name,
                field.type === "number" ? +e.target.value : e.target.value,
              )
            }
            style={{ width: "100%", marginTop: 4 }}
          />
        );
      case "textarea":
        return (
          <textarea
            rows={4}
            value={v}
            onChange={(e) => saveField(field.name, e.target.value)}
            style={{ width: "100%", marginTop: 4 }}
          />
        );
      case "select":
        return (
          <select
            value={v}
            onChange={(e) => saveField(field.name, e.target.value)}
            style={{ width: "100%", marginTop: 4 }}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );
      // add more types as needed...
      default:
        return null;
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>
        {schema.label} Sheet{" "}
        <small style={{ fontSize: "0.8em", color: "#666" }}>
          ({sheetId.slice(0, 6)})
        </small>
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone ? onDone() : navigate("/");
        }}
      >
        {schema.fields.map((field) => (
          <div key={field.name} style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 500 }}>
              {field.label}
              {field.required && <span style={{ color: "red" }}> *</span>}
            </label>
            {renderField(field)}
          </div>
        ))}

        <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
          <button type="submit" style={{ padding: "8px 16px" }}>
            Save &amp; Close
          </button>
          <button
            type="button"
            onClick={() => {
              deleteFactSheet(sheetId);
              onDone ? onDone() : navigate("/");
            }}
            style={{
              padding: "8px 16px",
              background: "#fdd",
              border: "1px solid #f99",
            }}
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => (onDone ? onDone() : navigate("/"))}
            style={{ padding: "8px 16px" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
