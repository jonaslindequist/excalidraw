import { z } from "zod";

/** ---------- Common ---------- */

const KVAny = z.record(z.string(), z.any());
export const Anchor = z.object({
  // "viewport:center" | "selection:center" | "frame:<id>" | "@tempId"
  ref: z.string(),
  align: z
    .enum([
      "center",
      "top-left",
      "top-center",
      "top-right",
      "left-center",
      "right-center",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ])
    .optional(),
  offset: z.tuple([z.number(), z.number()]).default([0, 0]),
});

/**
 * Selector (recursive)
 * - byId
 * - byTitle
 * - byTitleLike
 * - byFact { kind, attrs }
 * - inFrame <Selector> with optional filter
 */
export const Selector: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.object({ byId: z.string() }),
    z.object({ byTitle: z.string() }),
    z.object({ byTitleLike: z.string() }),
    z.object({
      byFact: z.object({
        kind: z.string(),
        attrs: KVAny.optional(),
      }),
    }),
    z.object({
      inFrame: Selector, // recursive
      filter: z.object({ type: z.string().optional() }).optional(),
    }),
  ]),
);

/** ---------- Ops ---------- */

const CreateFrame = z.object({
  op: z.literal("create_frame"),
  tempId: z.string(),
  title: z.string().min(1),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }),
  anchor: Anchor,
  customData: KVAny.optional(),
});

const CreateElement = z.object({
  op: z.literal("create_element"),
  tempId: z.string().optional(),
  type: z.enum(["rectangle", "ellipse", "diamond", "text", "image"]),
  text: z.string().optional(), // if type==='text'
  label: z.string().optional(), // stored in customData.title for non-text
  frame: z.union([Selector, z.string()]).nullable().optional(), // "@tempId" or selector or null
  size: z
    .object({ w: z.number().positive(), h: z.number().positive() })
    .optional(),
  anchor: Anchor,
  fact: z
    .object({
      ensure: z.literal(true),
      kind: z.string(),
      attrs: KVAny,
      idHint: z.string().optional(),
    })
    .optional(),
});

const Connect = z.object({
  op: z.literal("connect"),
  from: z.union([Selector, z.string()]),
  to: z.union([Selector, z.string()]),
  style: z
    .object({
      label: z.string().optional(),
      dashed: z.boolean().optional(),
      thickness: z.number().optional(),
      direction: z.enum(["uni", "bi"]).optional(),
    })
    .optional(),
});

const Update = z.object({
  op: z.literal("update"),
  target: z.union([Selector, z.string()]),
  set: z.object({
    title: z.string().optional(),
    size: z
      .object({ w: z.number().positive(), h: z.number().positive() })
      .optional(),
    collapsed: z.boolean().optional(),
    customData: KVAny.optional(),
  }),
});

const EnsureFact = z.object({
  op: z.literal("ensure_fact"),
  tempId: z.string().optional(),
  kind: z.string(),
  attrs: KVAny,
});

const LinkFact = z.object({
  op: z.literal("link_fact"),
  target: z.union([Selector, z.string()]),
  // string = existing id or "@tempId"
  // (enforce "@..." only with: z.string().regex(/^@/) if you need a separate branch)
  fact: z.union([
    z.string(),
    z.object({ kind: z.string(), match: KVAny.optional() }),
  ]),
});

export const PlanSchema = z.object({
  version: z.literal("1"),
  plan: z.array(
    z.union([
      CreateFrame,
      CreateElement,
      Connect,
      Update,
      EnsureFact,
      LinkFact,
    ]),
  ),
  meta: z
    .object({ confidence: z.number().min(0).max(1).default(0.5) })
    .optional(),
});

export type AnchorT = z.infer<typeof Anchor>;
export type SelectorT = z.infer<typeof Selector>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanOp = Plan["plan"][number];
