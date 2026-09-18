import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Permission } from './permission.entity';

@Entity({ name: 'roles' })
export class Role extends BaseEntity {
  @ApiProperty({ example: 'HR_MANAGER' })
  @Column({ type: 'varchar', length: 50, unique: true })
  name: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** Seeded roles: cannot be deleted or renamed; permissions still editable. */
  @ApiProperty()
  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @ApiProperty({ type: () => [Permission] })
  @ManyToMany(() => Permission, { eager: false })
  @JoinTable({
    name: 'role_permissions',
    joinColumn: { name: 'role_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permission_id', referencedColumnName: 'id' },
  })
  permissions: Permission[];
}
