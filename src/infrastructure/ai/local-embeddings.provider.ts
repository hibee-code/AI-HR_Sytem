import type { EmbeddingKind, EmbeddingsProvider } from './embeddings.interface';

type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/**
 * Runs an open Hugging Face embedding model inside the process (Transformers.js
 * + ONNX Runtime, CPU): free, no API, no credits. The model (~20–130 MB) is
 * downloaded from the Hub once into EMBEDDINGS_CACHE_DIR — the Docker image
 * bakes it in at build time — and loaded lazily on first use.
 *
 * Models such as bge / e5 expect a prefix on queries and/or passages; set
 * EMBEDDING_QUERY_PREFIX / EMBEDDING_DOCUMENT_PREFIX to match the model card.
 */
export class LocalEmbeddingsProvider implements EmbeddingsProvider {
  private extractor: Promise<Extractor> | null = null;

  constructor(
    readonly model: string,
    readonly dimensions: number,
    private readonly cacheDir: string,
    private readonly prefixes: { query: string; document: string } = {
      query: '',
      document: '',
    },
  ) {}

  async embed(
    texts: string[],
    kind: EmbeddingKind = 'document',
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extract = await this.load();
    const prefix = this.prefixes[kind];
    const out = await extract(
      texts.map((t) => prefix + t),
      { pooling: 'mean', normalize: true },
    );
    const rows = out.tolist();
    if (rows[0]?.length !== this.dimensions)
      throw new Error(
        `Embedding size ${rows[0]?.length} ≠ configured ${this.dimensions} for ${this.model}`,
      );
    return rows;
  }

  private load(): Promise<Extractor> {
    this.extractor ??= (async () => {
      // ESM-only package: loaded lazily so tests and fake drivers never pay for it.
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = this.cacheDir;
      return (await pipeline('feature-extraction', this.model, {
        dtype: 'q8', // 8-bit quantised: ~4× smaller, near-identical vectors
      })) as unknown as Extractor;
    })().catch((err: unknown) => {
      this.extractor = null; // allow a retry after e.g. a network blip
      throw err;
    });
    return this.extractor;
  }
}
