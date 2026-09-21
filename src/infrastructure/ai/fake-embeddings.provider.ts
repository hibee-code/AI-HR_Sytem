import { createHash } from 'node:crypto';
import type { EmbeddingsProvider } from './embeddings.interface';

/**
 * Deterministic bag-of-words hashing embedding for tests and offline dev.
 * Similar texts share tokens and therefore land close in cosine space.
 */
export class FakeEmbeddingsProvider implements EmbeddingsProvider {
  readonly model = 'fake-hash-embeddings';

  constructor(readonly dimensions = 384) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const v: number[] = Array.from({ length: this.dimensions }, () => 0);
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const h = createHash('md5').update(token).digest();
      const idx = h.readUInt32BE(0) % this.dimensions;
      v[idx] += h[4] % 2 === 0 ? 1 : -1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}
