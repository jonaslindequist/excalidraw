// facts-repo.ts

import { FactEdge, FactId, FactSheetBase, FactType } from "./facts-domain";

export interface FactsRepository {
  upsertFact(f: FactSheetBase): Promise<void>;
  getFact(id: FactId): Promise<FactSheetBase | undefined>;
  findFacts(q: {
    namespace: string;
    type?: FactType;
    text?: string;
    ids?: FactId[];
  }): Promise<FactSheetBase[]>;
  deleteFact(id: FactId): Promise<void>;

  upsertEdge(e: FactEdge): Promise<void>;
  getEdges(q: {
    namespace: string;
    from?: FactId;
    to?: FactId;
    kind?: FactEdge["kind"];
  }): Promise<FactEdge[]>;
  deleteEdge(id: string): Promise<void>;
}

export interface FindFactsQuery {
  namespace: string;
  type?: FactType;
  text?: string; // title/description/tags contains
  ids?: FactId[];
  limit?: number;
}

export interface GetEdgesQuery {
  namespace: string;
  from?: FactId;
  to?: FactId;
  kind?: FactEdge["kind"];
}

export interface FactsRepository {
  upsertFact(f: FactSheetBase): Promise<void>;
  getFact(id: FactId): Promise<FactSheetBase | undefined>;
  findFacts(q: FindFactsQuery): Promise<FactSheetBase[]>;
  deleteFact(id: FactId): Promise<void>;

  upsertEdge(e: FactEdge): Promise<void>;
  getEdges(q: GetEdgesQuery): Promise<FactEdge[]>;
  deleteEdge(id: string): Promise<void>;
}
