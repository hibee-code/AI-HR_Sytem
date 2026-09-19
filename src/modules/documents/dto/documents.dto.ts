import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  DocumentCategory,
  DocumentVisibility,
} from '../entities/document.entity';

/** Multipart fields accompanying `file` on POST /documents. */
export class CreateDocumentDto {
  @ApiProperty({ example: 'Employment contract 2026' })
  @IsString()
  @MaxLength(200)
  title: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
  @ApiProperty({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category: DocumentCategory;

  @ApiPropertyOptional({
    enum: DocumentVisibility,
    default: DocumentVisibility.PRIVATE,
  })
  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Defaults to the caller’s own employee; HR may set anyone or omit for company-level',
  })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;
}

export class UpdateDocumentDto extends PartialType(
  PickType(CreateDocumentDto, [
    'title',
    'description',
    'category',
    'visibility',
  ] as const),
) {}

export class ListDocumentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerEmployeeId?: string;
  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;
  @ApiPropertyOptional({ enum: DocumentVisibility })
  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;
  @ApiPropertyOptional({ description: 'Title search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class DownloadLinkResponse {
  @ApiProperty() url: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() filename: string;
  @ApiProperty() version: number;
}

/** Shape of an uploaded file as multer hands it over (memory storage). */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
