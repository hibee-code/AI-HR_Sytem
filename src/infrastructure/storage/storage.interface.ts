export type StorageResourceType = 'image' | 'raw';

export interface UploadOptions {
  /** Logical folder, e.g. `employees/<id>/documents`. */
  folder: string;
  /** Original filename; the extension decides the raw format. */
  filename: string;
  mimeType: string;
  /** private = only reachable via signed URLs; public = plain CDN URL (profile photos). */
  access: 'private' | 'public';
}

export interface StoredObject {
  /** Provider key (Cloudinary public_id). */
  key: string;
  resourceType: StorageResourceType;
  /** Direct URL; only usable for public objects. */
  url: string;
  bytes: number;
}

export interface SignedUrlOptions {
  resourceType: StorageResourceType;
  expiresInSeconds: number;
  /** Suggested download filename. */
  filename?: string;
}

/**
 * Object storage port. Cloudinary in real environments, in-memory in tests.
 * Nothing outside infrastructure/storage imports the Cloudinary SDK.
 */
export interface StorageService {
  upload(buffer: Buffer, options: UploadOptions): Promise<StoredObject>;
  signedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string>;
  delete(key: string, resourceType: StorageResourceType): Promise<void>;
}

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export function resourceTypeFor(mimeType: string): StorageResourceType {
  return mimeType.startsWith('image/') ? 'image' : 'raw';
}
