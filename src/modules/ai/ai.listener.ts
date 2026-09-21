import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from 'nestjs-pino';
import { DOCUMENT_EVENTS } from '../documents/documents.service';
import type { DocumentChangedEvent } from '../documents/documents.service';
import { AiProcessor } from './ai.processor';

/** Any document change → re-evaluate it for the knowledge base (the job decides eligibility). */
@Injectable()
export class AiListener {
  constructor(
    private readonly processor: AiProcessor,
    private readonly logger: Logger,
  ) {}

  @OnEvent(DOCUMENT_EVENTS.CHANGED, { async: true, promisify: true })
  async onDocumentChanged(e: DocumentChangedEvent): Promise<void> {
    try {
      await this.processor.enqueueIndex(e.documentId);
    } catch (err) {
      this.logger.error(
        { err, documentId: e.documentId },
        'failed to enqueue knowledge base indexing',
      );
    }
  }
}
