import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { instanceToPlain } from 'class-transformer';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { EmployeesService } from '../employees/employees.service';
import { SERIALIZE_FULL } from '../employees/entities/employee.entity';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { DocumentsService } from './documents.service';
import {
  CreateDocumentDto,
  DownloadLinkResponse,
  ListDocumentsQueryDto,
  UpdateDocumentDto,
} from './dto/documents.dto';
import type { UploadedFile } from './dto/documents.dto';

/** Multer keeps files in memory; the service enforces size/type before anything is stored. */
const upload = () =>
  UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }),
  );

@ApiTags('documents')
@ApiBearerAuth('access-token')
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly employees: EmployeesService,
  ) {}

  @Post()
  @RequirePermissions(PERMISSIONS.DOCUMENT_UPLOAD)
  @upload()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title', 'category'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        visibility: { type: 'string' },
        ownerEmployeeId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a new document (first version)' })
  create(
    @UploadedFileParam() file: UploadedFile,
    @Body() dto: CreateDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.documents.create(file, dto, actor);
  }

  @Post(':id/versions')
  @RequirePermissions(PERMISSIONS.DOCUMENT_UPLOAD)
  @upload()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a new version; becomes current' })
  addVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFileParam() file: UploadedFile,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.documents.addVersion(id, file, actor);
  }

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.DOCUMENT_READ_SELF,
    PERMISSIONS.DOCUMENT_READ_ALL,
  )
  @ApiOperation({ summary: 'Documents I may see (HR: all), filterable' })
  list(@Query() query: ListDocumentsQueryDto, @CurrentUser() actor: AuthUser) {
    return this.documents.list(query, actor);
  }

  @Get('me')
  @RequirePermissions(PERMISSIONS.DOCUMENT_READ_SELF)
  @ApiOperation({ summary: 'My own documents' })
  async mine(
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    query.ownerEmployeeId = me.id;
    return this.documents.list(query, actor);
  }

  @Get(':id')
  @RequireAnyPermission(
    PERMISSIONS.DOCUMENT_READ_SELF,
    PERMISSIONS.DOCUMENT_READ_ALL,
  )
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const doc = await this.documents.findById(id);
    if (!(await this.documents.canRead(doc, actor)))
      throw new ForbiddenException();
    return doc;
  }

  @Get(':id/download')
  @RequireAnyPermission(
    PERMISSIONS.DOCUMENT_READ_SELF,
    PERMISSIONS.DOCUMENT_READ_ALL,
  )
  @ApiQuery({ name: 'version', required: false, type: Number })
  @ApiOkResponse({ type: DownloadLinkResponse })
  @ApiOperation({
    summary: 'Short-lived signed download link (current or a specific version)',
  })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @Query('version', new ParseIntPipe({ optional: true })) version?: number,
  ) {
    return this.documents.downloadLink(id, actor, version);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_UPLOAD)
  @ApiOperation({ summary: 'Edit metadata (uploader or HR)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.documents.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_UPLOAD)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete (versions and files are retained)' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.documents.remove(id, actor);
  }

  // ── Profile photos ────────────────────────────────────────────────────

  @Put('profile-photo/me')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ_SELF)
  @upload()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Set my profile photo (png/jpeg/webp, ≤ 5 MB)' })
  async myPhoto(
    @UploadedFileParam() file: UploadedFile,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return instanceToPlain(await this.documents.setProfilePhoto(me.id, file), {
      groups: [SERIALIZE_FULL],
    });
  }

  @Put('profile-photo/:employeeId')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_UPDATE)
  @upload()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  async photoFor(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @UploadedFileParam() file: UploadedFile,
  ) {
    return instanceToPlain(
      await this.documents.setProfilePhoto(employeeId, file),
      { groups: [SERIALIZE_FULL] },
    );
  }
}
