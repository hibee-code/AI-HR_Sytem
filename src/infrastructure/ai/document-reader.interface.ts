/** Reads documents with no text layer (scanned PDFs) — vision/OCR. */
export interface DocumentReader {
  /** False when no capable provider is configured. */
  readonly available: boolean;
  transcribePdf(pdf: Buffer): Promise<string>;
}

export const DOCUMENT_READER = Symbol('DOCUMENT_READER');

/** Used when no provider can read scans (fake driver, no Anthropic key). */
export const NO_DOCUMENT_READER: DocumentReader = {
  available: false,
  transcribePdf: () =>
    Promise.reject(new Error('No document reader configured')),
};
