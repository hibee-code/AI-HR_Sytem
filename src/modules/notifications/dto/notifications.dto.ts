import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  NotificationChannel,
  NotificationStatus,
} from '../entities/notification-log.entity';

export class UpdatePreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() slackEnabled?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'U01ABC23DEF',
    description: 'null = re-resolve by email',
  })
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @Matches(/^[UW][A-Z0-9]{8,}$/, {
    message: 'slackUserId must be a Slack member id',
  })
  slackUserId?: string | null;
}

export class ListNotificationLogDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: NotificationStatus })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
  @ApiPropertyOptional({ enum: NotificationChannel })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  recipientUserId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  template?: string;
}
