// facts-context.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { FactEdge, FactId, FactSheetBase, FactType } from "./facts-domain";
import type {
  FactsRepository,
  FindFactsQuery,
  GetEdgesQuery,
} from "./facts-repo";
import { FactsRepositoryMemory } from "./facts-repo-memory";

export type UpsertFactInput = {
  id?: FactId;
  // Optional here to allow partial updates through upsert; required at runtime on create.
  type?: FactType;
  title?: string;
  description?: string;
  tags?: string[];
  owners?: string[];
  status?: "draft" | "active" | "deprecated" | "retired";
  lifecycle?: { introduced?: string; sunset?: string };
  attrs?: Record<string, unknown>;
  namespace?: string;
  // Optional timestamps; provider will fill in.
  createdAt?: number;
  updatedAt?: number;
  counters?: { inboundEdges?: number; outboundEdges?: number };
};

export type UpsertEdgeInput = {
  id?: string;
  from: FactId;
  to: FactId;
  kind: FactEdge["kind"];
  meta?: Record<string, unknown>;
};

type FactsAPI = {
  namespace: string;
  repo: FactsRepository;

  facts: FactSheetBase[];
  edges: FactEdge[];

  reload: () => Promise<void>;

  upsertFact: (input: UpsertFactInput) => Promise<FactSheetBase>;
  /** Convenience: patch existing fact without worrying about immutables/timestamps */
  updateFact: (
    id: FactId,
    patch: Partial<
      Omit<
        FactSheetBase,
        "id" | "type" | "namespace" | "createdAt" | "updatedAt"
      >
    >,
  ) => Promise<FactSheetBase>;

  deleteFact: (id: FactId) => Promise<void>;
  bulkImport: (payload: {
    facts?: FactSheetBase[];
    edges?: FactEdge[];
  }) => Promise<void>;

  upsertEdge: (input: UpsertEdgeInput) => Promise<FactEdge>;
  deleteEdge: (id: string) => Promise<void>;

  findFacts: (q: Omit<FindFactsQuery, "namespace">) => Promise<FactSheetBase[]>;
  getEdges: (q: Omit<GetEdgesQuery, "namespace">) => Promise<FactEdge[]>;
};

const FactsContext = createContext<FactsAPI | null>(null);

export const FactsProvider: React.FC<{
  children: React.ReactNode;
  repo?: FactsRepository; // pluggable storage (defaults to memory)
  namespace?: string; // scope facts to a scene/space
}> = ({ children, repo, namespace = "default-scene" }) => {
  const [theRepo] = useState<FactsRepository>(
    () => repo ?? new FactsRepositoryMemory(),
  );
  const [facts, setFacts] = useState<FactSheetBase[]>([]);
  const [edges, setEdges] = useState<FactEdge[]>([]);

  const reload = async () => {
    const [f, e] = await Promise.all([
      theRepo.findFacts({ namespace }),
      theRepo.getEdges({ namespace }),
    ]);
    setFacts(f);
    setEdges(e);
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namespace, theRepo]);

  const api = useMemo<FactsAPI>(() => {
    const upsertFact = async (input: UpsertFactInput) => {
      const now = Date.now();
      const id = input.id ?? crypto.randomUUID();
      const prev = await theRepo.getFact(id);

      // Enforce required fields on CREATE (when no previous record exists)
      if (!prev && !input.type) {
        throw new Error("upsertFact: 'type' is required when creating a fact");
      }

      const fact: FactSheetBase = {
        id,
        type: (input.type ?? prev?.type)!,
        title: input.title ?? prev?.title ?? "Untitled",
        description: input.description ?? prev?.description,
        tags: input.tags ?? prev?.tags ?? [],
        owners: input.owners ?? prev?.owners ?? [],
        status: input.status ?? prev?.status ?? "draft",
        lifecycle: input.lifecycle ?? prev?.lifecycle,
        namespace: input.namespace ?? prev?.namespace ?? namespace,
        attrs: input.attrs ?? prev?.attrs ?? {},
        createdAt: prev?.createdAt ?? input.createdAt ?? now,
        updatedAt: now,
        counters: input.counters ?? prev?.counters,
      };

      await theRepo.upsertFact(fact);
      await reload();
      return fact;
    };

    const updateFact = async (
      id: FactId,
      patch: Partial<
        Omit<
          FactSheetBase,
          "id" | "type" | "namespace" | "createdAt" | "updatedAt"
        >
      >,
    ) => {
      const prev = await theRepo.getFact(id);
      if (!prev) {
        throw new Error(`updateFact: fact '${id}' not found`);
      }
      const now = Date.now();
      const fact: FactSheetBase = {
        ...prev,
        ...patch,
        id: prev.id,
        type: prev.type,
        namespace: prev.namespace,
        createdAt: prev.createdAt,
        updatedAt: now,
      };
      await theRepo.upsertFact(fact);
      await reload();
      return fact;
    };

    const deleteFact = async (id: FactId) => {
      await theRepo.deleteFact(id);
      await reload();
    };

    const bulkImport = async (payload: {
      facts?: FactSheetBase[];
      edges?: FactEdge[];
    }) => {
      const now = Date.now();

      if (payload.facts?.length) {
        for (const f of payload.facts) {
          await theRepo.upsertFact({
            ...f,
            namespace: f.namespace || namespace,
            createdAt: f.createdAt ?? now,
            updatedAt: now,
          });
        }
      }
      if (payload.edges?.length) {
        for (const e of payload.edges) {
          await theRepo.upsertEdge({
            ...e,
            namespace: e.namespace || namespace,
            createdAt: e.createdAt ?? now,
            updatedAt: now,
          });
        }
      }
      await reload();
    };

    const upsertEdge = async (input: UpsertEdgeInput) => {
      const now = Date.now();
      const id = input.id ?? crypto.randomUUID();
      const edge: FactEdge = {
        id,
        namespace,
        from: input.from,
        to: input.to,
        kind: input.kind,
        meta: input.meta,
        createdAt: now,
        updatedAt: now,
      };
      await theRepo.upsertEdge(edge);
      await reload();
      return edge;
    };

    const deleteEdge = async (id: string) => {
      await theRepo.deleteEdge(id);
      await reload();
    };

    const findFacts = (q: Omit<FindFactsQuery, "namespace">) =>
      theRepo.findFacts({ ...q, namespace });

    const getEdges = (q: Omit<GetEdgesQuery, "namespace">) =>
      theRepo.getEdges({ ...q, namespace });

    return {
      namespace,
      repo: theRepo,
      facts,
      edges,
      reload,
      upsertFact,
      updateFact,
      deleteFact,
      bulkImport,
      upsertEdge,
      deleteEdge,
      findFacts,
      getEdges,
    };
  }, [facts, edges, namespace, theRepo]);

  return <FactsContext.Provider value={api}>{children}</FactsContext.Provider>;
};

export const useFacts = () => {
  const ctx = useContext(FactsContext);
  if (!ctx) throw new Error("useFacts must be used within FactsProvider");
  return ctx;
};
