import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { EmployeesService } from '../employees/employees.service';
import { PERMISSIONS } from '../rbac/permissions.catalogue';
import {
  CreateRunDto,
  SetFxRatesDto,
  CreateStructureDto,
  ListPayslipsQueryDto,
  ListRunsQueryDto,
} from './dto/payroll.dto';
import { PayrollService } from './payroll.service';
import { Audit } from '../audit/audit.decorator';
import { Payslip } from './entities/payslip.entity';
import { PayrollRun } from './entities/payroll-run.entity';
import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';

@ApiTags('payroll')
@ApiBearerAuth('access-token')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly employees: EmployeesService,
  ) {}

  // ── Salary structures (HR) ────────────────────────────────────────────

  @Audit('payroll.structure.create', 'salary_structure', {
    bodyKeys: ['employeeId', 'effectiveFrom'],
  })
  @Post('structures')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({
    summary: 'Set a new effective-dated structure; the previous one is closed',
  })
  createStructure(
    @Body() dto: CreateStructureDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.payroll.createStructure(dto, userId);
  }

  @Get('structures/me')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ_SELF)
  @ApiOperation({ summary: 'My current and past salary structures' })
  async myStructures(@CurrentUser() actor: AuthUser) {
    return this.payroll.structuresFor((await this.requireProfile(actor)).id);
  }

  @Audit('payroll.structure.view', 'employee', { idParam: 'employeeId' })
  @Get('structures/employee/:employeeId')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  structuresFor(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payroll.structuresFor(employeeId);
  }

  // ── Runs (HR) ─────────────────────────────────────────────────────────

  @Get('runs')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiPaginatedResponse(PayrollRun)
  listRuns(@Query() query: ListRunsQueryDto) {
    return this.payroll.listRuns(query);
  }

  @Audit('payroll.run.create', 'payroll_run', {
    bodyKeys: ['periodStart', 'periodEnd', 'departmentId'],
  })
  @Post('runs')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  createRun(@Body() dto: CreateRunDto, @CurrentUser('id') userId: string) {
    return this.payroll.createRun(dto, userId);
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  getRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.findRun(id);
  }

  @Put('runs/:id/fx-rates')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @Audit('payroll.run.fx_rates', 'payroll_run', { bodyKeys: ['fxRates'] })
  @ApiOperation({
    summary:
      'Set FX rates (into the run currency) before calculating; draft/calculated runs only',
  })
  setFxRates(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFxRatesDto,
  ) {
    return this.payroll.setFxRates(id, dto.fxRates);
  }

  @Audit('payroll.run.calculate', 'payroll_run')
  @Post('runs/:id/calculate')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({
    summary:
      'Compute payslips for everyone in scope (repeatable until approved)',
  })
  calculate(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.calculate(id);
  }

  @Audit('payroll.run.approve', 'payroll_run')
  @Post('runs/:id/approve')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiOperation({ summary: 'Freeze, generate payslip PDFs, notify employees' })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payroll.approve(id, userId);
  }

  @Audit('payroll.run.mark_paid', 'payroll_run')
  @Post('runs/:id/mark-paid')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  markPaid(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.markPaid(id);
  }

  @Audit('payroll.run.delete', 'payroll_run')
  @Delete('runs/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRun(@Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.deleteRun(id);
  }

  // ── Payslips ──────────────────────────────────────────────────────────

  @Get('payslips')
  @RequirePermissions(PERMISSIONS.PAYROLL_MANAGE)
  @ApiPaginatedResponse(Payslip)
  listPayslips(@Query() query: ListPayslipsQueryDto) {
    return this.payroll.listPayslips(query);
  }

  @Get('payslips/me')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ_SELF)
  @ApiOperation({ summary: 'My payslips from approved/paid runs' })
  @ApiPaginatedResponse(Payslip)
  async myPayslips(
    @Query() query: ListPayslipsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payroll.listPayslips(
      query,
      (await this.requireProfile(actor)).id,
    );
  }

  @Audit('payroll.payslip.view', 'payslip')
  @Get('payslips/:id')
  @RequirePermissions(PERMISSIONS.PAYROLL_READ_SELF)
  @ApiOperation({
    summary: 'Payslip detail; the PDF is at /documents/:documentId/download',
  })
  getPayslip(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.payroll.findPayslip(id, actor);
  }

  private async requireProfile(actor: AuthUser) {
    const me = await this.employees.findByUserId(actor.id);
    if (!me)
      throw new NotFoundException(
        'No employee profile is linked to your login',
      );
    return me;
  }
}
