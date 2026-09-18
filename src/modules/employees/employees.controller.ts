import {
  Body,
  Controller,
  ForbiddenException,
  Get,
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
import { instanceToPlain } from 'class-transformer';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  AssignmentChangeDto,
  ChangeStatusDto,
  CreateEmployeeDto,
  LinkUserDto,
  ListEmployeesQueryDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
  UpdateSelfDto,
} from './dto/employee.dto';
import { Employee, SERIALIZE_FULL } from './entities/employee.entity';
import { EmployeesService } from './employees.service';

/**
 * Visibility rules (see Employee entity's serialisation groups):
 *  - `employee:read` holders (HR/Admin) see full records for everyone.
 *  - Everyone sees their own full record.
 *  - A manager sees full records for anyone in their reporting chain.
 *  - Otherwise `employee:read_directory` gives the directory view.
 */
@ApiTags('employees')
@ApiBearerAuth('access-token')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  // ── Self-service ──────────────────────────────────────────────────────

  @Get('me')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ_SELF)
  @ApiOperation({ summary: 'My employee profile' })
  async me(@CurrentUser() actor: AuthUser) {
    return full(await this.requireOwnProfile(actor));
  }

  @Patch('me')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ_SELF)
  @ApiOperation({ summary: 'Update my contact details' })
  async updateMe(@CurrentUser() actor: AuthUser, @Body() dto: UpdateSelfDto) {
    return full(await this.employees.updateSelf(actor.id, dto));
  }

  @Get('me/team')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ_SELF)
  @ApiOperation({ summary: 'My direct reports' })
  async myTeam(@CurrentUser() actor: AuthUser) {
    const me = await this.requireOwnProfile(actor);
    return (await this.employees.directReports(me.id)).map(full);
  }

  @Get('me/history')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_READ_SELF)
  async myHistory(@CurrentUser() actor: AuthUser) {
    const me = await this.requireOwnProfile(actor);
    return this.employees.historyFor(me.id);
  }

  // ── Directory & org chart ─────────────────────────────────────────────

  @Get()
  @RequireAnyPermission(
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
  )
  @ApiOperation({
    summary: 'Search employees (full or directory view by permission)',
  })
  async list(
    @Query() query: ListEmployeesQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const page = await this.employees.list(query);
    const view = actor.permissions.includes(PERMISSIONS.EMPLOYEE_READ)
      ? full
      : directory;
    return { data: page.data.map(view), meta: page.meta };
  }

  @Get('org-chart')
  @RequireAnyPermission(
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
  )
  @ApiQuery({
    name: 'rootId',
    required: false,
    description: 'Start from this employee',
  })
  @ApiOperation({ summary: 'Reporting-line tree' })
  orgChart(@Query('rootId') rootId?: string) {
    return this.employees.orgChart(rootId || undefined);
  }

  @Get(':id')
  @RequireAnyPermission(
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
  )
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const emp = await this.employees.findById(id);
    return (await this.canSeeFull(actor, emp)) ? full(emp) : directory(emp);
  }

  @Get(':id/reports')
  @RequireAnyPermission(
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
  )
  @ApiOperation({ summary: 'Direct reports of an employee' })
  async reports(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const emp = await this.employees.findById(id);
    const view = (await this.canSeeFull(actor, emp)) ? full : directory;
    return (await this.employees.directReports(id)).map(view);
  }

  @Get(':id/history')
  @RequireAnyPermission(
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_DIRECTORY,
  )
  @ApiOperation({ summary: 'Employment history (full-view callers only)' })
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const emp = await this.employees.findById(id);
    if (!(await this.canSeeFull(actor, emp))) throw new ForbiddenException();
    return this.employees.historyFor(id);
  }

  // ── HR operations ─────────────────────────────────────────────────────

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_CREATE)
  @ApiOperation({
    summary: 'Hire: create an employee, optionally inviting a login',
  })
  async create(@Body() dto: CreateEmployeeDto, @CurrentUser() actor: AuthUser) {
    return full(await this.employees.create(dto, actor.id));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_UPDATE)
  @ApiOperation({ summary: 'Update profile fields (not org placement)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return full(await this.employees.updateProfile(id, dto));
  }

  @Post(':id/assignments')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_UPDATE)
  @ApiOperation({
    summary: 'Promote / transfer / change manager (writes history)',
  })
  async changeAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentChangeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return full(await this.employees.changeAssignment(id, dto, actor.id));
  }

  @Put(':id/status')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_UPDATE)
  @ApiOperation({ summary: 'ONBOARDING→ACTIVE, ACTIVE↔ON_LEAVE' })
  async changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return full(await this.employees.changeStatus(id, dto, actor.id));
  }

  @Post(':id/terminate')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DELETE)
  @ApiOperation({ summary: 'End employment; reports move up, login suspended' })
  async terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateEmployeeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return full(await this.employees.terminate(id, dto, actor.id));
  }

  @Post(':id/link-user')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_UPDATE)
  @ApiOperation({ summary: 'Attach an existing login to this employee' })
  async linkUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkUserDto,
  ) {
    return full(await this.employees.linkUser(id, dto.userId));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async requireOwnProfile(actor: AuthUser): Promise<Employee> {
    const emp = await this.employees.findByUserId(actor.id);
    if (!emp)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return emp;
  }

  private async canSeeFull(
    actor: AuthUser,
    target: Employee,
  ): Promise<boolean> {
    if (actor.permissions.includes(PERMISSIONS.EMPLOYEE_READ)) return true;
    if (target.userId === actor.id) return true;
    const me = await this.employees.findByUserId(actor.id);
    return me ? this.employees.isInReportingChain(me.id, target.id) : false;
  }
}

/** Full record: personal fields included. */
function full(emp: Employee): Record<string, unknown> {
  return instanceToPlain(emp, { groups: [SERIALIZE_FULL] });
}

/** Directory view: group-tagged (personal) fields are omitted. */
function directory(emp: Employee): Record<string, unknown> {
  return instanceToPlain(emp);
}
