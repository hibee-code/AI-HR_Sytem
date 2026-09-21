import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { UploadedFile } from '../documents/dto/documents.dto';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  ApplyDto,
  CreateOpeningDto,
  ListApplicationsQueryDto,
  ListOpeningsQueryDto,
  UpdateApplicationStatusDto,
  UpdateOpeningDto,
} from './dto/recruiting.dto';
import { RecruitingProcessor } from './recruiting.processor';
import { RecruitingService } from './recruiting.service';

@ApiTags('recruiting')
@ApiBearerAuth('access-token')
@Controller('recruiting')
export class RecruitingController {
  constructor(
    private readonly recruiting: RecruitingService,
    private readonly processor: RecruitingProcessor,
  ) {}

  // ── Openings ──────────────────────────────────────────────────────────

  @Get('openings')
  @RequirePermissions(PERMISSIONS.RECRUITING_READ)
  listOpenings(@Query() query: ListOpeningsQueryDto) {
    return this.recruiting.listOpenings(query);
  }

  @Post('openings')
  @RequirePermissions(PERMISSIONS.RECRUITING_MANAGE)
  createOpening(
    @Body() dto: CreateOpeningDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.recruiting.createOpening(dto, userId);
  }

  @Get('openings/:id')
  @RequirePermissions(PERMISSIONS.RECRUITING_READ)
  getOpening(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.findOpening(id);
  }

  @Patch('openings/:id')
  @RequirePermissions(PERMISSIONS.RECRUITING_MANAGE)
  @ApiOperation({
    summary: 'Edit; set status OPEN to accept applications, CLOSED to stop',
  })
  updateOpening(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpeningDto,
  ) {
    return this.recruiting.updateOpening(id, dto);
  }

  // ── Applications ──────────────────────────────────────────────────────

  @Post('openings/:id/applications')
  @RequirePermissions(PERMISSIONS.RECRUITING_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'firstName', 'lastName', 'email'],
      properties: {
        file: { type: 'string', format: 'binary' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        source: { type: 'string' },
        coverLetter: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Register an application with a résumé; AI screening is queued automatically',
  })
  async apply(
    @Param('id', ParseUUIDPipe) openingId: string,
    @UploadedFileParam() file: UploadedFile | undefined,
    @Body() dto: ApplyDto,
    @CurrentUser('id') userId: string,
  ) {
    const app = await this.recruiting.apply(openingId, dto, file, userId);
    await this.processor.enqueueScreen(app.id);
    return app;
  }

  @Get('openings/:id/applications')
  @RequirePermissions(PERMISSIONS.RECRUITING_READ)
  @ApiOperation({
    summary:
      'Ranked pipeline (fitScore desc by default); scores are AI-assisted and advisory',
  })
  listApplications(
    @Param('id', ParseUUIDPipe) openingId: string,
    @Query() query: ListApplicationsQueryDto,
  ) {
    return this.recruiting.listApplications(openingId, query);
  }

  @Get('applications/:id')
  @RequirePermissions(PERMISSIONS.RECRUITING_READ)
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.findApplication(id);
  }

  @Get('applications/:id/resume')
  @RequirePermissions(PERMISSIONS.RECRUITING_READ)
  @ApiOperation({ summary: 'Signed download link for the résumé' })
  async resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.recruiting.resumeDownloadLink(
      await this.recruiting.findApplication(id),
    );
  }

  @Put('applications/:id/status')
  @RequirePermissions(PERMISSIONS.RECRUITING_MANAGE)
  @ApiOperation({
    summary: 'Human decision on the application (with optional note)',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationStatusDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.recruiting.updateStatus(id, dto, userId);
  }

  @Post('applications/:id/rescreen')
  @RequireAnyPermission(
    PERMISSIONS.RECRUITING_SCREEN,
    PERMISSIONS.RECRUITING_MANAGE,
  )
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue screening again (e.g. after requirements changed)',
  })
  async rescreen(@Param('id', ParseUUIDPipe) id: string) {
    await this.recruiting.findApplication(id);
    const job = await this.processor.enqueueScreen(id);
    return { jobId: job.id };
  }

  @Post('openings/:id/rescreen')
  @RequireAnyPermission(
    PERMISSIONS.RECRUITING_SCREEN,
    PERMISSIONS.RECRUITING_MANAGE,
  )
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue screening for every application of an opening',
  })
  async rescreenOpening(@Param('id', ParseUUIDPipe) openingId: string) {
    const page = await this.recruiting.listApplications(
      openingId,
      Object.assign(new ListApplicationsQueryDto(), { page: 1, limit: 100 }),
    );
    for (const app of page.data) await this.processor.enqueueScreen(app.id);
    return { queued: page.data.length };
  }
}
