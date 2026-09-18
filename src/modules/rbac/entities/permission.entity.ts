import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

@Entity({ name: 'permissions' })
export class Permission extends BaseEntity {
  /** `resource:action`, e.g. `leave:approve`. Mirrors PERMISSIONS catalogue. */
  @ApiProperty({ example: 'leave:approve' })
  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;
}
