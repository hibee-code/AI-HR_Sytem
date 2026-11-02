/** Search queries and stored passages may be embedded differently (bge, e5). */
export type EmbeddingKind = 'query' | 'document';

/** Turns text into vectors; every implementation must produce `dimensions`-long arrays. */
export interface EmbeddingsProvider {
  readonly dimensions: number;
  readonly model: string;
  embed(texts: string[], kind?: EmbeddingKind): Promise<number[][]>;
}

export const EMBEDDINGS_PROVIDER = Symbol('EMBEDDINGS_PROVIDER');
