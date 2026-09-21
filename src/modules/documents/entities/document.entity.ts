import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from 'typeorm';
import { SoftDeletableEntity } from '../../../common/entities/base.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { DocumentVersion } from './document-version.entity';

export enum DocumentCategory {
  CONTRACT = 'CONTRACT',
  ID = 'ID',
  CERTIFICATE = 'CERTIFICATE',
  PAYSLIP = 'PAYSLIP',
  /** Company policy; COMPANY-visible ones feed the AI knowledge base (stage 9). */
  POLICY = 'POLICY',
  /** Candidate résumé (recruiting only; never owned by an employee). */
  RESUME = 'RESUME',
  OTHER = 'OTHER',
}

export enum DocumentVisibility {
  /** Owner, their reporting chain, HR. */
  PRIVATE = 'PRIVATE',
  /** Owner and HR only (ID scans, payslips). */
  RESTRICTED = 'RESTRICTED',
  /** Every logged-in employee. */
  COMPANY = 'COMPANY',
}

/**
 * A logical document with one or more versions; `currentVersion` is the
 * one served by default. Soft-deleted documents keep their versions and
 * storage objects (retention); nothing is purged automatically.
 */
@Entity({ name: 'documents' })
export class Document extends SoftDeletableEntity {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'null = company-level document',
  })
  @Index('idx_documents_owner_employee_id')
  @Column({ name: 'owner_employee_id', type: 'uuid', nullable: true })
  ownerEmployeeId: string | null;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_employee_id' })
  owner: Employee | null;

  @ApiProperty({ example: 'Employment contract 2026' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @ApiProperty({ enum: DocumentCategory })
  @Index('idx_documents_category')
  @Column({
    type: 'enum',
    enum: DocumentCategory,
    enumName: 'document_category',
  })
  category: DocumentCategory;

  @ApiProperty({ enum: DocumentVisibility })
  @Column({
    type: 'enum',
    enum: DocumentVisibility,
    enumName: 'document_visibility',
    default: DocumentVisibility.PRIVATE,
  })
  visibility: DocumentVisibility;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId: string | null;

  @OneToOne(() => DocumentVersion, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'current_version_id' })
  currentVersion: DocumentVersion | null;

  @OneToMany(() => DocumentVersion, (v) => v.document)
  versions: DocumentVersion[];

  /** Login that created the document; may edit it and add versions. */
  @Column({ name: 'uploaded_by_user_id', type: 'uuid', nullable: true })
  uploadedByUserId: string | null;

  /** Set by the knowledge-base ingester (stage 9) when this version was embedded. */
  @Column({ name: 'kb_indexed_at', type: 'timestamptz', nullable: true })
  kbIndexedAt: Date | null;
}
