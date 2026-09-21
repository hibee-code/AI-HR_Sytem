/** Turns text into vectors; every implementation must produce `dimensions`-long arrays. */
export interface EmbeddingsProvider {
  readonly dimensions: number;
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDINGS_PROVIDER = Symbol('EMBEDDINGS_PROVIDER');
