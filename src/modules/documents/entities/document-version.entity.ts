import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { StorageResourceType } from '../../../infrastructure/storage/storage.interface';
import { Document } from './document.entity';

@Entity({ name: 'document_versions' })
@Index('uq_document_versions_document_version', ['documentId', 'version'], {
  unique: true,
})
export class DocumentVersion {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => Document, (d) => d.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @ApiProperty({ example: 2 })
  @Column({ type: 'int' })
  version: number;

  /** Provider key; never exposed to clients (downloads go through signed URLs). */
  @Exclude()
  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey: string;

  @Exclude()
  @Column({ name: 'resource_type', type: 'varchar', length: 10 })
  resourceType: StorageResourceType;

  @ApiProperty({ example: 'contract.pdf' })
  @Column({ name: 'original_filename', type: 'varchar', length: 255 })
  originalFilename: string;

  @ApiProperty({ example: 'application/pdf' })
  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @ApiProperty()
  @Column({ type: 'int' })
  bytes: number;

  @ApiProperty({ description: 'SHA-256 of the file' })
  @Column({ type: 'char', length: 64 })
  checksum: string;

  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
