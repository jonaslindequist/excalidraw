import type { Plan } from "./schemas";

/** Minimal context you’ll pass to the model (or mock). Keep it small. */
export type AiContext = {
  viewport: { center: [number, number]; zoom: number };
  selection: { ids: string[] };
  focusedFrameId?: string | null;
  frames: Array<{ id: string; title: string; collapsed: boolean }>;
  elements: Array<{
    id: string;
    type: string;
    frameId?: string | null;
    title?: string;
  }>;
  facts: Array<{ id: string; kind: string; attrs: Record<string, any> }>;
};

/** Mock “LLM”: returns a plausible plan for demo purposes. */
export async function generatePlanMock(
  userPrompt: string,
  ctx: AiContext,
): Promise<Plan> {
  // A couple of very tiny branching behaviours to feel "smart"
  const inFrame = ctx.focusedFrameId ?? ctx.frames[0]?.id ?? null;

  if (/payments/i.test(userPrompt)) {
    return {
      version: "1",
      plan: [
        {
          op: "create_frame",
          tempId: "payments",
          title: "Payments",
          size: { w: 700, h: 360 },
          anchor: {
            ref: inFrame ? `frame:${inFrame}` : "viewport:center",
            align: "center",
            offset: [820, 0],
          },
          customData: { expandable: true },
        },
        {
          op: "create_element",
          tempId: "svc_writer",
          type: "rectangle",
          label: "Billing Writer",
          frame: "@payments",
          size: { w: 220, h: 120 },
          anchor: { ref: "@payments", align: "left-center", offset: [40, 0] },
          fact: {
            ensure: true,
            kind: "microservice",
            attrs: { owner: "Payments", language: "Go" },
            idHint: "billing-writer",
          },
        },
        {
          op: "create_element",
          tempId: "svc_reader",
          type: "rectangle",
          label: "Billing Reader",
          frame: "@payments",
          size: { w: 220, h: 120 },
          anchor: { ref: "@payments", align: "right-center", offset: [-40, 0] },
          fact: {
            ensure: true,
            kind: "microservice",
            attrs: { owner: "Payments", language: "Node.js" },
            idHint: "billing-reader",
          },
        },
        {
          op: "connect",
          from: "@svc_writer",
          to: "@svc_reader",
          style: { label: "replicates events", direction: "uni" },
        },
      ],
      meta: { confidence: 0.72 },
    };
  }

  // default tiny plan
  return {
    version: "1",
    plan: [
      {
        op: "create_element",
        tempId: "note",
        type: "text",
        text: userPrompt.trim() || "Note",
        frame: inFrame ?? null,
        anchor: {
          ref: inFrame ? `frame:${inFrame}` : "viewport:center",
          align: "center",
          offset: [0, 0],
        },
      },
    ],
    meta: { confidence: 0.55 },
  };
}
