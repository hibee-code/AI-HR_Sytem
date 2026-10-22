import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Opts a route (or whole controller) out of the global JwtAuthGuard.
 * In Swagger, `security: [{}]` marks it as callable without a token.
 */
export const Public = () =>
  applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiSecurity({}));
