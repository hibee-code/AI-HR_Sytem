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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyPermission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { addDays, todayIso } from '../../common/utils/date';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import { AttendanceService } from './attendance.service';
import {
  ClockDto,
  ManualRecordDto,
  RangeQueryDto,
  ReportQueryDto,
  UpdateRecordDto,
} from './dto/attendance.dto';

@ApiTags('attendance')
@ApiBearerAuth('access-token')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly employees: EmployeesService,
  ) {}

  // ── Self ──────────────────────────────────────────────────────────────

  @Post('clock-in')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_CLOCK)
  async clockIn(@Body() dto: ClockDto, @CurrentUser() actor: AuthUser) {
    return this.attendance.clockIn(
      (await this.requireProfile(actor)).id,
      dto.note,
    );
  }

  @Post('clock-out')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_CLOCK)
  async clockOut(@Body() dto: ClockDto, @CurrentUser() actor: AuthUser) {
    return this.attendance.clockOut(
      (await this.requireProfile(actor)).id,
      dto.note,
    );
  }

  @Get('me')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_CLOCK)
  @ApiOperation({
    summary: 'My sessions and daily totals (default: last 30 days)',
  })
  async me(@Query() q: RangeQueryDto, @CurrentUser() actor: AuthUser) {
    const me = await this.requireProfile(actor);
    const [from, to] = range(q);
    return {
      openSession: await this.attendance.openSession(me.id),
      ...(await this.attendance.recordsFor(me.id, from, to)),
    };
  }

  // ── Team / HR ─────────────────────────────────────────────────────────

  @Get('employees/:employeeId')
  @RequireAnyPermission(
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ATTENDANCE_READ_TEAM,
  )
  async forEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() q: RangeQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.assertAccess(employeeId, actor);
    const [from, to] = range(q);
    return this.attendance.recordsFor(employeeId, from, to);
  }

  @Get('report')
  @RequireAnyPermission(
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ATTENDANCE_READ_TEAM,
  )
  @ApiOperation({
    summary:
      'Monthly per-employee totals (HR: all/department; managers: direct reports)',
  })
  async report(@Query() q: ReportQueryDto, @CurrentUser() actor: AuthUser) {
    if (actor.permissions.includes(PERMISSIONS.ATTENDANCE_MANAGE)) {
      return this.attendance.monthlyReport(q.month, {
        departmentId: q.departmentId,
      });
    }
    const me = await this.requireProfile(actor);
    const reports = await this.employees.directReports(me.id);
    return this.attendance.monthlyReport(q.month, {
      employeeIds: reports.map((r) => r.id),
    });
  }

  @Post('records')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @ApiOperation({ summary: 'HR: add a session manually' })
  createManual(
    @Body() dto: ManualRecordDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.attendance.createManual(dto, userId);
  }

  @Patch('records/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  updateRecord(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecordDto,
  ) {
    return this.attendance.update(id, dto);
  }

  @Delete('records/:id')
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRecord(@Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.remove(id);
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

  private async assertAccess(
    employeeId: string,
    actor: AuthUser,
  ): Promise<void> {
    if (actor.permissions.includes(PERMISSIONS.ATTENDANCE_MANAGE)) return;
    const me = await this.requireProfile(actor);
    if (!(await this.employees.isInReportingChain(me.id, employeeId)))
      throw new ForbiddenException('Not your report');
  }
}

function range(q: RangeQueryDto): [string, string] {
  const to = q.to ?? todayIso();
  const from = q.from ?? addDays(to, -30);
  return [from, to];
}
