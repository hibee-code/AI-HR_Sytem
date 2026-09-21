import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { extname } from 'node:path';
import type { Env } from '../../config/env.schema';
import {
  resourceTypeFor,
  SignedUrlOptions,
  StorageResourceType,
  StorageService,
  StoredObject,
  UploadOptions,
} from './storage.interface';

/**
 * Cloudinary adapter. Private objects are uploaded with `type: 'private'`
 * and served only through short-lived signed download URLs.
 */
@Injectable()
export class CloudinaryStorageService implements StorageService {
  constructor(config: ConfigService<Env, true>) {
    cloudinary.config({
      cloud_name: config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: config.get('CLOUDINARY_API_SECRET', { infer: true }),
      secure: true,
    });
  }

  upload(buffer: Buffer, options: UploadOptions): Promise<StoredObject> {
    const resourceType = resourceTypeFor(options.mimeType);
    const ext = extname(options.filename).toLowerCase();
    const base = options.filename
      .slice(0, options.filename.length - ext.length)
      .replace(/[^\w.-]+/g, '_');
    // Raw public_ids keep their extension so the CDN serves the right content type.
    const publicId = `${base}_${Date.now()}${resourceType === 'raw' ? ext : ''}`;

    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder,
          public_id: publicId,
          resource_type: resourceType,
          type: options.access === 'private' ? 'private' : 'upload',
          overwrite: false,
          use_filename: false,
        },
        (err, result?: UploadApiResponse) => {
          if (err || !result)
            return reject(err ?? new Error('Cloudinary returned no result'));
          resolve({
            key: result.public_id,
            resourceType,
            url: result.secure_url,
            bytes: result.bytes,
          });
        },
      );
      stream.end(buffer);
    });
  }

  async signedDownloadUrl(
    key: string,
    options: SignedUrlOptions,
  ): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    // Format is left empty: raw public_ids already carry their extension and
    // Cloudinary infers image formats from the stored asset.
    return cloudinary.utils.private_download_url(key, '', {
      resource_type: options.resourceType,
      type: 'private',
      expires_at: expiresAt,
      attachment: true,
    });
  }

  async download(
    key: string,
    resourceType: StorageResourceType,
  ): Promise<Buffer> {
    const url = await this.signedDownloadUrl(key, {
      resourceType,
      expiresInSeconds: 120,
    });
    const res = await fetch(url);
    if (!res.ok)
      throw new Error(
        `Cloudinary download failed: ${res.status} ${res.statusText}`,
      );
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string, resourceType: StorageResourceType): Promise<void> {
    await cloudinary.uploader.destroy(key, {
      resource_type: resourceType,
      type: 'private',
      invalidate: true,
    });
  }
}
