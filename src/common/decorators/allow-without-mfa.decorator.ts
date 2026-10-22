import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_MFA_KEY = 'allowWithoutMfa';

/**
 * Routes a user whose role requires MFA may call before enrolling
 * (profile, MFA setup, logout). Everything else returns 403 MFA_SETUP_REQUIRED.
 */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA_KEY, true);
