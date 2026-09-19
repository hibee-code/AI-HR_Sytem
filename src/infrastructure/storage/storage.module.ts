import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { CloudinaryStorageService } from './cloudinary-storage.service';
import { MemoryStorageService } from './memory-storage.service';
import { STORAGE_SERVICE } from './storage.interface';

/** Picks the storage driver from STORAGE_DRIVER (cloudinary | memory). */
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('STORAGE_DRIVER', { infer: true }) === 'memory'
          ? new MemoryStorageService()
          : new CloudinaryStorageService(config),
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
