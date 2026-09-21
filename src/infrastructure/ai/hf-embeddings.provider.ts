import { InferenceClient } from '@huggingface/inference';
import type { EmbeddingsProvider } from './embeddings.interface';

/** Hugging Face Inference API feature-extraction (sentence-transformers style, mean-pooled). */
export class HfEmbeddingsProvider implements EmbeddingsProvider {
  private readonly client: InferenceClient;

  constructor(
    token: string,
    readonly model: string,
    readonly dimensions: number,
  ) {
    this.client = new InferenceClient(token);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out = await this.client.featureExtraction({
      model: this.model,
      inputs: texts,
    });
    // The API returns number[] for a single input and number[][] for a batch.
    const rows = (
      texts.length === 1 && typeof out[0] === 'number' ? [out] : out
    ) as number[][];
    for (const row of rows) {
      if (row.length !== this.dimensions) {
        throw new Error(
          `Embedding size ${row.length} ≠ configured ${this.dimensions} for ${this.model}`,
        );
      }
    }
    return rows;
  }
}
