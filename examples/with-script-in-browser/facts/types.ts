export interface ElementFacts {
  systemName?: string;
  owner?: string;
  description?: string;
  // …any other fields, attachments, history…
}

export interface FactType {
  /** unique key, e.g. "microservice" or "integration" */
  id: string;
  /** human-friendly name shown in the UI */
  label: string;
  /** JSON-schema-like field definitions */
  fields: FactField[];
}

type FieldType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "date"
  | "textarea";
export interface FactField {
  name: string; // e.g. "owner" or "version"
  label: string; // e.g. "Owner" or "Version"
  type: FieldType;
  required?: boolean;
  /** for "select" */
  options?: { value: any; label: string }[];
  /** optional default */
  default?: any;
  /** placeholder, help text, validation rules, etc. */
  ui?: { placeholder?: string; helpText?: string; pattern?: string };
}

export type FactsStore = Record<string, ElementFacts>;

/** each sheet instance lives independently */
export interface FactSheet {
  id: string;
  typeId: string;
  values: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

/** the catalog of all sheets */
export type FactSheetStore = Record<string, FactSheet>;

export const factTypes: FactType[] = [
  {
    id: "microservice",
    label: "Microservice",
    fields: [
      {
        name: "systemName",
        label: "System Name",
        type: "string",
        required: true,
      },
      { name: "owner", label: "Owner", type: "string" },
      { name: "version", label: "Version", type: "string", default: "1.0.0" },
      { name: "endpoint", label: "Endpoint URL", type: "string" },
      {
        name: "healthStatus",
        label: "Health Status",
        type: "select",
        options: [
          { value: "green", label: "🟢 Green" },
          { value: "yellow", label: "🟡 Yellow" },
          { value: "red", label: "🔴 Red" },
        ],
        default: "green",
      },
      { name: "description", label: "Description", type: "textarea" },
    ],
  },

  // ...you can register more types here...
];
