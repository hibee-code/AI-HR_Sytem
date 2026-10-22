import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface ClientInfo {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Caller IP + user agent for session records and the audit trail. Read from
 * the request (not @Headers), so docs and clients never see it as a parameter.
 */
export const Client = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ClientInfo => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return { ipAddress: req.ip, userAgent: req.get('user-agent') };
  },
);
