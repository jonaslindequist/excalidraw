import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { z } from "zod";
import type { Selector as SelectorT } from "./schemas";
import { FactsStore } from "./store";

/** Resolve a selector or @tempId → concrete element ids (array) */
export function resolveSelector(
  api: ExcalidrawImperativeAPI,
  selOrId: z.infer<typeof SelectorT> | string,
  tempToReal: Map<string, string>,
): string[] {
  if (typeof selOrId === "string") {
    if (selOrId.startsWith("@")) {
      const real = tempToReal.get(selOrId);
      return real ? [real] : [];
    }
    // plain id
    return [selOrId];
  }
  const els = api.getSceneElementsIncludingDeleted();

  if ("byId" in selOrId) return [selOrId.byId];

  if ("byTitle" in selOrId) {
    return els
      .filter((e: any) => (e.customData?.title ?? e.name) === selOrId.byTitle)
      .map((e) => e.id);
  }
  if ("byTitleLike" in selOrId) {
    const q = selOrId.byTitleLike.toLowerCase();
    return els
      .filter((e: any) =>
        ((e.customData?.title ?? e.name) || "").toLowerCase().includes(q),
      )
      .map((e) => e.id);
  }
  if ("byFact" in selOrId) {
    const { kind, attrs } = selOrId.byFact;
    return els
      .filter(
        (e: any) =>
          e.customData?.factId &&
          FactsStore.get(e.customData.factId)?.kind === kind,
      )
      .filter((e: any) => {
        if (!attrs) return true;
        const f = FactsStore.get(e.customData!.factId)!;
        return Object.entries(attrs).every(([k, v]) => f.attrs?.[k] === v);
      })
      .map((e) => e.id);
  }
  if ("inFrame" in selOrId) {
    const frameIds = resolveSelector(api, (selOrId as any).inFrame, tempToReal);
    const frameId = frameIds[0];
    if (!frameId) return [];
    const list = els.filter((e) => e.frameId === frameId);
    if ((selOrId as any).filter?.type) {
      return list
        .filter((e) => e.type === (selOrId as any).filter.type)
        .map((e) => e.id);
    }
    return list.map((e) => e.id);
  }
  return [];
}
