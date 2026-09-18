import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AssigneeRule, ChecklistTemplate } from './checklist-template.entity';

@Entity({ name: 'checklist_template_items' })
export class ChecklistTemplateItem extends BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @Index('idx_checklist_template_items_template_id')
  @Column({ name: 'template_id', type: 'uuid' })
  templateId: string;

  @ManyToOne(() => ChecklistTemplate, (t) => t.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template: ChecklistTemplate;

  @ApiProperty({ example: 'Sign employment contract' })
  @Column({ type: 'varchar', length: 200 })
  title: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 1000, nullable: true })
  description: string | null;

  @ApiProperty({ enum: AssigneeRule })
  @Column({
    name: 'assignee_rule',
    type: 'enum',
    enum: AssigneeRule,
    enumName: 'assignee_rule',
  })
  assigneeRule: AssigneeRule;

  @ApiProperty({ nullable: true, example: 'IT_SUPPORT' })
  @Column({
    name: 'assignee_role_name',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  assigneeRoleName: string | null;

  /** Days relative to the anchor (hire date / last day). Negative = before. */
  @ApiProperty({ example: 3 })
  @Column({ name: 'due_offset_days', type: 'int', default: 0 })
  dueOffsetDays: number;

  @ApiProperty()
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Optional tasks don't block checklist completion. */
  @ApiProperty()
  @Column({ name: 'is_required', type: 'boolean', default: true })
  isRequired: boolean;
}
