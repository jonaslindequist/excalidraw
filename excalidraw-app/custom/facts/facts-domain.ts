export type FactType =
  | "Application"
  | "Capability"     // replaces BusinessCapability / BusinessContext
  | "Process"        // optional, if you want to keep process flows
  | "DataObject"
  | "Service"        // replaces Interface
  | "Platform"
  | "TechComponent"  // replaces ITComponent
  | "Vendor"         // replaces Provider
  | "Initiative"
  | "Objective"
  | "Organization"
  | "TechCategory";


export type FactId = string;

export interface FactSheetBase {
  id: FactId;
  type: FactType;
  title: string;
  description?: string;
  tags?: string[];
  owners?: string[]; // emails or user ids
  status?: "draft" | "active" | "deprecated" | "retired";
  lifecycle?: { introduced?: string; sunset?: string };
  namespace: string; // e.g. "default-scene" (you already pass this)
  createdAt: number;
  updatedAt: number;
  // free-form typed payload; validated by schema registry
  attrs: Record<string, unknown>;
  // denormalized convenience (optional)
  counters?: { inboundEdges?: number; outboundEdges?: number };
}

export interface FactEdge {
  id: string; // cuid/uuid
  namespace: string;
  from: FactId;
  to: FactId;
  kind:
    | "implements" // Application -> BusinessCapability
    | "supports" // ITComponent -> Application
    | "exchanges" // Interface -> DataObject
    | "depends_on" // Application -> Application/ITComponent
    | "owned_by" // Any -> Organization/Provider
    | "belongs_to" // DataObject -> Domain/Platform
    | "realizes" // Initiative -> Objective
    | "groups" // Platform/TechCategory -> ITComponent
    | "interfaces" // Application -> Interface
    | "context_of" // BusinessContext -> Capability/Process
    | "custom";
  meta?: Record<string, unknown>; // frequency, SLA, direction, etc.
  createdAt: number;
  updatedAt: number;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "string" | "markdown" | "enum" | "number" | "date" | "array" | "link";
  required?: boolean;
  options?: string[];
  help?: string;
}

export interface RelationDef {
  kind: FactEdge["kind"];
  to: FactType[]; // allowed target types
  cardinality: "one" | "many";
  label: string;
}

export interface FactSchema {
  fields: FieldDef[];
  relations: RelationDef[];
}

export const EMPTY_SCHEMA: FactSchema = { fields: [], relations: [] } as const;

// ✅ Only define what you have now, TS still checks shape of each entry.
//    Requires TS 4.9+ for `satisfies`.
// ✅ Only define what you have now, TS still checks shape of each entry.
//    Requires TS 4.9+ for `satisfies`.

export const SCHEMA = {
  Application: {
    fields: [
      { key: "lifecycleStage", label: "Lifecycle Stage", type: "enum", options: ["Plan", "Live", "Phase-out"] },
      { key: "criticality", label: "Criticality", type: "enum", options: ["Low", "Medium", "High"] },
      { key: "ownerTeam", label: "Owner Team", type: "string" },
    ],
    relations: [
      { kind: "implements", to: ["Capability"],           cardinality: "many", label: "Implements Capabilities" },
      { kind: "interfaces", to: ["Service"],              cardinality: "many", label: "Consumes/Exposes Services" },
      { kind: "belongs_to",    to: ["TechComponent"],        cardinality: "many", label: "Runs On" },
      { kind: "depends_on", to: ["Application"],          cardinality: "many", label: "Depends On" },
      { kind: "owned_by",   to: ["Organization","Vendor"], cardinality: "one", label: "Owner" },
    ],
  },

  DataObject: {
    fields: [
      { key: "sensitivity", label: "Sensitivity", type: "enum", options: ["Public","Internal","Confidential","Restricted"] },
      { key: "retention", label: "Retention", type: "string" },
    ],
    relations: [
      { kind: "exchanges", to: ["Service"],  cardinality: "many", label: "Exchanged via" },
      { kind: "belongs_to",    to: ["Platform"], cardinality: "one",  label: "Domain/Platform" },
    ],
  },
} as const satisfies Partial<Record<FactType, FactSchema>>;

// Use this everywhere you previously read `SCHEMA[type]`
export const getSchema = (type: FactType): FactSchema =>
  SCHEMA[type] ?? EMPTY_SCHEMA;