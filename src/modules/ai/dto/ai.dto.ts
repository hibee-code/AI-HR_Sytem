import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChatDto {
  @ApiProperty({ example: 'How many days of annual leave do I get?' })
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Continue an existing conversation',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class ReindexDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'One document; omit to reindex every eligible policy',
  })
  @IsOptional()
  @IsUUID()
  documentId?: string;
}

export class SearchQueryDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(500) q: string;
}
