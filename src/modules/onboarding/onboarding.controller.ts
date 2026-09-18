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
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { ChecklistTemplatesService } from './checklist-templates.service';
import {
  CreateTemplateDto,
  ListChecklistsQueryDto,
  ReassignTaskDto,
  StartChecklistDto,
  TemplateItemDto,
  UpdateTaskDto,
  UpdateTemplateDto,
  UpdateTemplateItemDto,
} from './dto/onboarding.dto';
import { ChecklistType } from './entities/checklist-template.entity';
import { OnboardingProcessor } from './onboarding.processor';
import { OnboardingService } from './onboarding.service';

@ApiTags('onboarding')
@ApiBearerAuth('access-token')
@Controller()
export class OnboardingController {
  constructor(
    private readonly templates: ChecklistTemplatesService,
    private readonly onboarding: OnboardingService,
    private readonly employees: EmployeesService,
    private readonly processor: OnboardingProcessor,
  ) {}

  // ── Templates (HR) ────────────────────────────────────────────────────

  @Get('checklist-templates')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  @ApiQuery({ name: 'type', enum: ChecklistType, required: false })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listTemplates(
    @Query('type') type?: ChecklistType,
    @Query('includeInactive') inactive?: string,
  ) {
    return this.templates.findAll({
      type,
      includeInactive: inactive === 'true',
    });
  }

  @Get('checklist-templates/:id')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.findById(id);
  }

  @Post('checklist-templates')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch('checklist-templates/:id')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({
    summary: 'Update a template; passing `items` replaces the whole list',
  })
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templates.update(id, dto);
  }

  @Delete('checklist-templates/:id')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.templates.remove(id);
  }

  @Post('checklist-templates/:id/items')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  addItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TemplateItemDto,
  ) {
    return this.templates.addItem(id, dto);
  }

  @Patch('checklist-templates/items/:itemId')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateTemplateItemDto,
  ) {
    return this.templates.updateItem(itemId, dto);
  }

  @Delete('checklist-templates/items/:itemId')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  removeItem(@Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.templates.removeItem(itemId);
  }

  // ── Checklists ────────────────────────────────────────────────────────

  @Get('checklists')
  @RequirePermissions(PERMISSIONS.ONBOARDING_READ)
  listChecklists(@Query() query: ListChecklistsQueryDto) {
    return this.onboarding.list(query);
  }

  @Get('checklists/me')
  @ApiOperation({ summary: 'My own on/offboarding checklists' })
  async myChecklists(@CurrentUser() actor: AuthUser) {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return this.onboarding.forEmployee(me.id);
  }

  @Get('checklists/tasks/me')
  @ApiOperation({
    summary: 'Open tasks assigned to me (directly or via my roles)',
  })
  myTasks(@CurrentUser() actor: AuthUser) {
    return this.onboarding.myTasks(actor);
  }

  @Post('checklists')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @ApiOperation({
    summary:
      'Start a checklist manually (normally automatic on hire/termination)',
  })
  async startChecklist(
    @Body() dto: StartChecklistDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const c = await this.onboarding.start(dto.employeeId, dto.type, {
      templateId: dto.templateId,
      anchorDate: dto.anchorDate,
      actorUserId: actor.id,
    });
    if (!c)
      throw new NotFoundException(
        `No active ${dto.type} template is configured`,
      );
    return c;
  }

  @Get('checklists/:id')
  @ApiOperation({
    summary:
      'Checklist with tasks and progress (HR, the employee, or their chain)',
  })
  async getChecklist(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const c = await this.onboarding.findById(id);
    if (!(await this.onboarding.canView(c, actor)))
      throw new ForbiddenException();
    return c;
  }

  @Post('checklists/:id/cancel')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  cancelChecklist(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.cancel(id);
  }

  // ── Tasks ─────────────────────────────────────────────────────────────

  @Patch('checklists/tasks/:taskId')
  @ApiOperation({
    summary: 'Update status / notes / document (assignee, role holder, or HR)',
  })
  updateTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.onboarding.updateTask(taskId, dto, actor);
  }

  @Put('checklists/tasks/:taskId/assignee')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  reassignTask(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ReassignTaskDto,
  ) {
    return this.onboarding.reassignTask(taskId, dto);
  }

  // ── Ops ───────────────────────────────────────────────────────────────

  @Post('checklists/reminders/run')
  @RequirePermissions(PERMISSIONS.ONBOARDING_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue the daily reminder digest now' })
  async runReminders() {
    const job = await this.processor.runRemindersNow();
    return { jobId: job.id };
  }
}
