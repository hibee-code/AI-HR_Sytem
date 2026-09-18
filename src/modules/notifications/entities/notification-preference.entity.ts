import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Per-user delivery settings. Absent row = defaults (both channels on,
 * Slack id resolved lazily by email and cached here).
 */
@Entity({ name: 'notification_preferences' })
export class NotificationPreference {
  @ApiProperty({ format: 'uuid' })
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty()
  @Column({ name: 'email_enabled', type: 'boolean', default: true })
  emailEnabled: boolean;

  @ApiProperty()
  @Column({ name: 'slack_enabled', type: 'boolean', default: true })
  slackEnabled: boolean;

  @ApiProperty({ nullable: true, example: 'U01ABC23DEF' })
  @Column({
    name: 'slack_user_id',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  slackUserId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
