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
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { todayIso } from '../../common/utils/date';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  AdjustBalanceDto,
  BalanceQueryDto,
  CreateLeaveRequestDto,
  CreateLeaveRequestForDto,
  CreateLeaveTypeDto,
  DecideLeaveRequestDto,
  ListLeaveRequestsQueryDto,
  PublicHolidayDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto';
import { LeavePolicyService } from './leave-policy.service';
import { LeaveRequestsService } from './leave-requests.service';

@ApiTags('leave')
@ApiBearerAuth('access-token')
@Controller('leave')
export class LeaveController {
  constructor(
    private readonly policy: LeavePolicyService,
    private readonly requests: LeaveRequestsService,
    private readonly employees: EmployeesService,
  ) {}

  // ── Policy: types & holidays ──────────────────────────────────────────

  @Get('types')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_SELF)
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  listTypes(@Query('includeInactive') inactive?: string) {
    return this.policy.findTypes(inactive === 'true');
  }

  @Post('types')
  @RequirePermissions(PERMISSIONS.LEAVE_MANAGE_POLICY)
  createType(@Body() dto: CreateLeaveTypeDto) {
    return this.policy.createType(dto);
  }

  @Patch('types/:id')
  @RequirePermissions(PERMISSIONS.LEAVE_MANAGE_POLICY)
  updateType(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.policy.updateType(id, dto);
  }

  @Get('holidays')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_SELF)
  @ApiQuery({ name: 'year', required: false, type: Number })
  listHolidays(@Query('year') year?: string) {
    return this.policy.findHolidays(year ? Number(year) : undefined);
  }

  @Post('holidays')
  @RequirePermissions(PERMISSIONS.LEAVE_MANAGE_POLICY)
  addHoliday(@Body() dto: PublicHolidayDto) {
    return this.policy.addHoliday(dto);
  }

  @Delete('holidays/:id')
  @RequirePermissions(PERMISSIONS.LEAVE_MANAGE_POLICY)
  @HttpCode(HttpStatus.NO_CONTENT)
  removeHoliday(@Param('id', ParseUUIDPipe) id: string) {
    return this.policy.removeHoliday(id);
  }

  // ── Balances ──────────────────────────────────────────────────────────

  @Get('balances/me')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_SELF)
  async myBalances(
    @CurrentUser() actor: AuthUser,
    @Query() q: BalanceQueryDto,
  ) {
    const me = await this.requireProfile(actor);
    return this.policy.balancesFor(me.id, q.year ?? currentYear());
  }

  @Get('balances/:employeeId')
  @RequireAnyPermission(PERMISSIONS.LEAVE_READ_ALL, PERMISSIONS.LEAVE_READ_TEAM)
  async balances(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() q: BalanceQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.assertTeamAccess(employeeId, actor);
    return this.policy.balancesFor(employeeId, q.year ?? currentYear());
  }

  @Post('balances/adjust')
  @RequirePermissions(PERMISSIONS.LEAVE_MANAGE_POLICY)
  @ApiOperation({ summary: 'HR correction to a balance (audited)' })
  adjust(@Body() dto: AdjustBalanceDto, @CurrentUser('id') userId: string) {
    return this.policy.adjust(dto, userId);
  }

  // ── Requests ──────────────────────────────────────────────────────────

  @Post('requests')
  @RequirePermissions(PERMISSIONS.LEAVE_REQUEST)
  @ApiOperation({ summary: 'Submit a leave request for myself' })
  async submit(
    @Body() dto: CreateLeaveRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.requireProfile(actor);
    return this.requests.submit(me.id, dto, actor.id);
  }

  @Post('requests/on-behalf')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_ALL, PERMISSIONS.LEAVE_APPROVE)
  @ApiOperation({ summary: 'HR files a request for an employee' })
  submitFor(
    @Body() dto: CreateLeaveRequestForDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.submit(dto.employeeId, dto, actor.id);
  }

  @Get('requests/me')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_SELF)
  async myRequests(
    @Query() query: ListLeaveRequestsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.requireProfile(actor);
    query.employeeId = me.id;
    return this.requests.list(query);
  }

  @Get('requests/pending')
  @RequirePermissions(PERMISSIONS.LEAVE_APPROVE)
  @ApiOperation({ summary: 'Requests waiting for my decision' })
  pending(@CurrentUser() actor: AuthUser) {
    return this.requests.pendingFor(actor);
  }

  @Get('requests/team')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_TEAM)
  @ApiOperation({ summary: 'Requests of my direct reports (team calendar)' })
  async team(
    @Query() query: ListLeaveRequestsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.requireProfile(actor);
    const reports = await this.employees.directReports(me.id);
    return this.requests.list(
      query,
      reports.map((r) => r.id),
    );
  }

  @Get('requests')
  @RequirePermissions(PERMISSIONS.LEAVE_READ_ALL)
  @ApiOperation({
    summary:
      'All requests (HR), filterable by employee/department/status/window',
  })
  listAll(@Query() query: ListLeaveRequestsQueryDto) {
    return this.requests.list(query);
  }

  @Get('requests/:id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const r = await this.requests.findById(id);
    if (!(await this.requests.canView(r, actor)))
      throw new ForbiddenException();
    return r;
  }

  @Post('requests/:id/approve')
  @RequirePermissions(PERMISSIONS.LEAVE_APPROVE)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.approve(id, actor, dto.note);
  }

  @Post('requests/:id/reject')
  @RequirePermissions(PERMISSIONS.LEAVE_APPROVE)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.reject(id, actor, dto.note);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'Withdraw my request (HR: anyone’s)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveRequestDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.requests.cancel(id, actor, dto.note);
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async requireProfile(actor: AuthUser) {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return me;
  }

  private async assertTeamAccess(
    employeeId: string,
    actor: AuthUser,
  ): Promise<void> {
    if (actor.permissions.includes(PERMISSIONS.LEAVE_READ_ALL)) return;
    const me = await this.requireProfile(actor);
    if (!(await this.employees.isInReportingChain(me.id, employeeId)))
      throw new ForbiddenException('Not your report');
  }
}

function currentYear(): number {
  return Number(todayIso().slice(0, 4));
}
