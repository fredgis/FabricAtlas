import type { AtlasSchema } from '../../../data/schema.js';

type Filter = Record<string, unknown>;

export interface RowQuery<T> {
  where(filter: Filter): RowQuery<T>;
  orderBy(order: Record<string, 'asc' | 'desc'>): RowQuery<T>;
  first(count: number): RowQuery<T>;
  after(cursor: string): RowQuery<T>;
  execute(): Promise<T[]>;
  executePaginated(): Promise<{ items: T[]; hasNextPage: boolean; endCursor?: string | null }>;
}

/**
 * Full-row data seam used by the durable sync framework. Rayfin 2.0 types
 * reads by their selection; this framework keeps its 1.x row contract, so the
 * Rayfin data client is adapted to it with `asRowClients` at the wiring point.
 */
export interface RowClient<T> {
  findById(id: string): Promise<T | null>;
  create(values: T): Promise<unknown>;
  update(where: { id: string }, values: Partial<T>): Promise<unknown>;
  select(fields: readonly (keyof T)[]): RowQuery<T>;
}

export type RowClients<Name extends keyof AtlasSchema> = {
  [Key in Name]: RowClient<AtlasSchema[Key]>;
};

export function asRowClients<Name extends keyof AtlasSchema>(data: unknown): RowClients<Name> {
  return data as RowClients<Name>;
}
