import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import * as mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { DocumentReader } from '../../infrastructure/ai/document-reader.interface';

/** Plain text from the formats the documents module accepts for ingestion. */
/** Text shorter than this from a PDF means "no text layer" (a scan). */
const MIN_TEXT_CHARS = 50;

export class ScannedDocumentError extends Error {}

/**
 * extractText, plus a vision fallback for scanned PDFs (no text layer):
 * transcribed by the DocumentReader when one is configured.
 */
export async function extractTextOrTranscribe(
  buffer: Buffer,
  mimeType: string,
  reader: DocumentReader,
): Promise<string> {
  const text = (await extractText(buffer, mimeType)).trim();
  if (mimeType !== 'application/pdf' || text.length >= MIN_TEXT_CHARS)
    return text;
  if (!reader.available)
    throw new ScannedDocumentError(
      'Scanned PDF with no text layer; reading scans needs ANTHROPIC_API_KEY',
    );
  return (await reader.transcribePdf(buffer)).trim();
}

export async function extractText(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf': {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case 'text/plain':
    case 'text/markdown':
    case 'text/csv':
      return buffer.toString('utf8');
    default:
      throw new UnsupportedContentError(`Cannot extract text from ${mimeType}`);
  }
}

export class UnsupportedContentError extends Error {}

export interface TextChunk {
  index: number;
  content: string;
  tokenEstimate: number;
}

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200, // characters ≈ 300 tokens: fits MiniLM's window with room to spare
  chunkOverlap: 150,
  separators: ['\n\n', '\n', '. ', ' ', ''],
});

/** LangChain recursive splitting; whitespace-normalised, empty pieces dropped. */
export async function chunkText(text: string): Promise<TextChunk[]> {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return [];
  const pieces = await splitter.splitText(cleaned);
  return pieces
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((content, index) => ({
      index,
      content,
      tokenEstimate: Math.ceil(content.length / 4),
    }));
}
