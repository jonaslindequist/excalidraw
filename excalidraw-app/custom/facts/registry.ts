export type FactField =
  | {
      id: string;
      label: string;
      type: "text";
      placeholder?: string;
      required?: boolean;
      multiline?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "select";
      options: string[];
      required?: boolean;
    }
  | { id: string; label: string; type: "url"; placeholder?: string }
  | { id: string; label: string; type: "number"; min?: number; max?: number }
  | { id: string; label: string; type: "boolean" };

export type FactType = {
  id: string;
  label: string;
  icon: string; // simple emoji/icon; you can swap for SVG later
  fields: FactField[];
  color?: string; // optional accent for badges
};

export const FACT_TYPES: FactType[] = [
  {
    id: "system",
    label: "System",
    icon: "🧩",
    color: "#2563eb",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "owner", label: "Owner", type: "text" },
      {
        id: "domain",
        label: "Domain",
        type: "select",
        options: ["Sales", "Finance", "HR", "Platform", "Other"],
      },
      {
        id: "criticality",
        label: "Criticality",
        type: "select",
        options: ["Low", "Medium", "High"],
      },
      {
        id: "lifecycle",
        label: "Lifecycle",
        type: "select",
        options: ["Plan", "Live", "Sunset"],
      },
      {
        id: "description",
        label: "Description",
        type: "text",
        multiline: true,
      },
    ],
  },
  {
    id: "application",
    label: "Application",
    icon: "💻",
    color: "#7c3aed",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "owner", label: "Owner", type: "text" },
      {
        id: "tier",
        label: "Tier",
        type: "select",
        options: ["UI", "Service", "Data"],
      },
      {
        id: "repo",
        label: "Repository",
        type: "url",
        placeholder: "https://...",
      },
      {
        id: "description",
        label: "Description",
        type: "text",
        multiline: true,
      },
    ],
  },
  {
    id: "microservice",
    label: "Microservice",
    icon: "🧪",
    color: "#059669",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      { id: "owner", label: "Owner", type: "text" },
      {
        id: "language",
        label: "Language",
        type: "select",
        options: ["TypeScript", "Go", "Java", "Python", "Other"],
      },
      { id: "repo", label: "Repository", type: "url" },
      {
        id: "runtime",
        label: "Runtime",
        type: "select",
        options: ["Kubernetes", "Serverless", "VM", "Other"],
      },
      { id: "sla", label: "SLA (ms)", type: "number", min: 0 },
    ],
  },
  {
    id: "api",
    label: "API",
    icon: "🔗",
    color: "#ea580c",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      {
        id: "style",
        label: "Style",
        type: "select",
        options: ["REST", "GraphQL", "gRPC", "Event"],
      },
      {
        id: "baseUrl",
        label: "Base URL",
        type: "url",
        placeholder: "https://api.company.com",
      },
      { id: "version", label: "Version", type: "text", placeholder: "v1" },
    ],
  },
  {
    id: "integration",
    label: "Integration",
    icon: "🔌",
    color: "#0ea5e9",
    fields: [
      { id: "name", label: "Name", type: "text", required: true },
      {
        id: "pattern",
        label: "Pattern",
        type: "select",
        options: ["Sync", "Async", "ETL", "Event-Driven"],
      },
      {
        id: "cadence",
        label: "Cadence",
        type: "select",
        options: ["On Demand", "Hourly", "Daily", "Weekly"],
      },
    ],
  },
];

export const FACT_TYPES_BY_ID = new Map(
  FACT_TYPES.map((t) => [t.id, t] as const),
);
