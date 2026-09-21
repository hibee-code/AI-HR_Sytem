import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  resourceTypeFor,
  SignedUrlOptions,
  StorageResourceType,
  StorageService,
  StoredObject,
  UploadOptions,
} from './storage.interface';

/** Test/dev driver: keeps buffers in memory and mints fake signed URLs. */
@Injectable()
export class MemoryStorageService implements StorageService {
  readonly objects = new Map<
    string,
    { buffer: Buffer; options: UploadOptions }
  >();

  async upload(buffer: Buffer, options: UploadOptions): Promise<StoredObject> {
    const key = `${options.folder}/${createHash('sha1').update(buffer).digest('hex').slice(0, 12)}-${options.filename}`;
    this.objects.set(key, { buffer, options });
    return {
      key,
      resourceType: resourceTypeFor(options.mimeType),
      url: `memory://${key}`,
      bytes: buffer.length,
    };
  }

  async signedDownloadUrl(
    key: string,
    options: SignedUrlOptions,
  ): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    return `memory://${key}?expires=${expires}&sig=test`;
  }

  async download(
    key: string,
    _resourceType: StorageResourceType,
  ): Promise<Buffer> {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`memory storage: object ${key} not found`);
    return obj.buffer;
  }

  async delete(key: string, _resourceType: StorageResourceType): Promise<void> {
    this.objects.delete(key);
  }
}
