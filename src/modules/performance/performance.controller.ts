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
  Patch,
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
import { CyclesService } from './cycles.service';
import {
  AcknowledgeDto,
  AssessmentDto,
  CalibrateDto,
  CreateCycleDto,
  CreateGoalDto,
  ListCyclesQueryDto,
  ListGoalsQueryDto,
  ListReviewsQueryDto,
  ReassignReviewerDto,
  RequestFeedbackDto,
  SubmitFeedbackDto,
  UpdateCycleDto,
  UpdateGoalDto,
} from './dto/performance.dto';
import { GoalsService } from './goals.service';
import { PerformanceProcessor } from './performance.processor';
import { ReviewsService } from './reviews.service';

@ApiTags('performance')
@ApiBearerAuth('access-token')
@Controller('performance')
export class PerformanceController {
  constructor(
    private readonly cycles: CyclesService,
    private readonly reviews: ReviewsService,
    private readonly goals: GoalsService,
    private readonly employees: EmployeesService,
    private readonly processor: PerformanceProcessor,
  ) {}

  // ── Cycles (HR) ───────────────────────────────────────────────────────

  @Get('cycles')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  listCycles(@Query() query: ListCyclesQueryDto) {
    return this.cycles.list(query);
  }

  @Get('cycles/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  getCycle(@Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.findById(id);
  }

  @Post('cycles')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  createCycle(@Body() dto: CreateCycleDto, @CurrentUser('id') userId: string) {
    return this.cycles.create(dto, userId);
  }

  @Patch('cycles/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  updateCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCycleDto,
  ) {
    return this.cycles.update(id, dto);
  }

  @Delete('cycles/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCycle(@Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.remove(id);
  }

  @Post('cycles/:id/launch')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  @ApiOperation({
    summary: 'DRAFT → SELF_REVIEW; creates a review per employee in scope',
  })
  launch(@Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.launch(id);
  }

  @Post('cycles/:id/advance')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  @ApiOperation({
    summary: 'Move to the next phase (closing finalises ratings)',
  })
  advance(@Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.advance(id);
  }

  @Get('cycles/:id/report')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  @ApiOperation({
    summary: 'Per-department completion and rating distribution',
  })
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.cycles.report(id);
  }

  // ── Reviews ───────────────────────────────────────────────────────────

  @Get('reviews')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  listReviews(@Query() query: ListReviewsQueryDto) {
    return this.reviews.list(query);
  }

  @Get('reviews/me')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  @ApiOperation({ summary: 'My reviews across cycles' })
  async myReviews(
    @Query() query: ListReviewsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.requireProfile(actor);
    return this.reviews.list(query, [me.id]);
  }

  @Get('reviews/team')
  @RequirePermissions(PERMISSIONS.REVIEW_WRITE_TEAM)
  @ApiOperation({ summary: 'Reviews of my direct reports' })
  async teamReviews(
    @Query() query: ListReviewsQueryDto,
    @CurrentUser() actor: AuthUser,
  ) {
    const me = await this.requireProfile(actor);
    const reports = await this.employees.directReports(me.id);
    return this.reviews.list(
      query,
      reports.map((r) => r.id),
    );
  }

  @Get('reviews/pending')
  @RequirePermissions(PERMISSIONS.REVIEW_WRITE_TEAM)
  @ApiOperation({ summary: 'Reviews waiting on me as reviewer' })
  pending(@CurrentUser('id') userId: string) {
    return this.reviews.pendingForReviewer(userId);
  }

  @Get('reviews/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  @ApiOperation({ summary: 'Review with role-appropriate visibility' })
  getReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.view(id, actor);
  }

  @Put('reviews/:id/self')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  submitSelf(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssessmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.submitSelf(id, dto, actor);
  }

  @Put('reviews/:id/manager')
  @RequirePermissions(PERMISSIONS.REVIEW_WRITE_TEAM)
  submitManager(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssessmentDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.submitManager(id, dto, actor);
  }

  @Put('reviews/:id/calibrate')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  calibrate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CalibrateDto) {
    return this.reviews.calibrate(id, dto.finalRating, dto.note);
  }

  @Post('reviews/:id/acknowledge')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.acknowledge(id, dto.comment, actor);
  }

  @Put('reviews/:id/reviewer')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignReviewerDto,
  ) {
    return this.reviews.reassignReviewer(id, dto.reviewerUserId);
  }

  // ── Peer feedback ─────────────────────────────────────────────────────

  @Post('reviews/:id/feedback-requests')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  @ApiOperation({
    summary: 'Ask colleagues for feedback (employee, reviewer or HR)',
  })
  requestFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestFeedbackDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.requestFeedback(id, dto.giverUserIds, actor);
  }

  @Get('feedback/me')
  @ApiOperation({ summary: 'Feedback requests waiting for my answer' })
  myFeedbackRequests(@CurrentUser('id') userId: string) {
    return this.reviews.myFeedbackRequests(userId);
  }

  @Put('feedback/:id')
  submitFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitFeedbackDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.submitFeedback(id, dto, actor);
  }

  @Post('feedback/:id/decline')
  declineFeedback(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.reviews.submitFeedback(
      id,
      { strengths: '', improvements: '' },
      actor,
      true,
    );
  }

  // ── Goals ─────────────────────────────────────────────────────────────

  @Get('goals')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  @ApiOperation({ summary: 'Goals I may see (own, reports; HR: all)' })
  listGoals(@Query() query: ListGoalsQueryDto, @CurrentUser() actor: AuthUser) {
    return this.goals.list(query, actor);
  }

  @Post('goals')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  createGoal(@Body() dto: CreateGoalDto, @CurrentUser() actor: AuthUser) {
    return this.goals.create(dto, actor);
  }

  @Get('goals/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  getGoal(@Param('id', ParseUUIDPipe) id: string) {
    return this.goals.findById(id);
  }

  @Patch('goals/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  updateGoal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.goals.update(id, dto, actor);
  }

  @Post('goals/:id/approve')
  @RequirePermissions(PERMISSIONS.REVIEW_WRITE_TEAM)
  approveGoal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.goals.approve(id, actor);
  }

  @Delete('goals/:id')
  @RequirePermissions(PERMISSIONS.REVIEW_READ_SELF)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteGoal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.goals.remove(id, actor);
  }

  // ── Ops ───────────────────────────────────────────────────────────────

  @Post('reminders/run')
  @RequirePermissions(PERMISSIONS.REVIEW_MANAGE_CYCLES)
  @HttpCode(HttpStatus.ACCEPTED)
  async runReminders() {
    const job = await this.processor.runRemindersNow();
    return { jobId: job.id };
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
