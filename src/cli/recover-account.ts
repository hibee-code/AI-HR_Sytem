/**
 * Break-glass account recovery, for when nobody can sign in to fix it in the
 * app (e.g. the only admin lost their phone and recovery codes). Needs shell
 * access to the server — that is the authentication.
 *
 *   docker compose -f docker-compose.prod.yml exec app \
 *     node dist/cli/recover-account.js --email admin@company.com
 *
 * Unlocks the account, removes MFA (they re-enrol at next login) and signs
 * them out everywhere. Optionally sets a new password from the
 * RECOVERY_NEW_PASSWORD env var (kept off the command line and shell history):
 *
 *   ... exec -e RECOVERY_NEW_PASSWORD='…' app node dist/cli/recover-account.js --email …
 *
 * Every run is written to the audit trail as `user.break_glass`.
 */
import './no-workers.env'; // must stay first
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { hostname } from 'node:os';
import { AppModule } from '../app.module';
import { AuditService } from '../modules/audit/audit.service';
import { AcceptInviteDto } from '../modules/auth/dto/auth.dto';
import { AuthService } from '../modules/auth/auth.service';
import { MfaService } from '../modules/auth/mfa.service';
import { TokenService } from '../modules/auth/token.service';
import { RbacService } from '../modules/rbac/rbac.service';
import { UsersService } from '../modules/users/users.service';

async function main(): Promise<void> {
  const email = argValue('--email');
  if (!email) throw new Error('Usage: recover-account --email <address>');
  const password = process.env.RECOVERY_NEW_PASSWORD;
  if (password) {
    // Same policy as the API (AcceptInviteDto's password rules).
    const errors = validateSync(
      plainToInstance(AcceptInviteDto, { token: 'cli', password }),
    );
    if (errors.length)
      throw new Error(
        `RECOVERY_NEW_PASSWORD rejected: ${errors.flatMap((e) => Object.values(e.constraints ?? {})).join('; ')}`,
      );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const get = <T>(t: new (...a: never[]) => T) =>
      app.get(t, { strict: false });
    const users = get(UsersService);
    const user = await users.findByEmail(email);
    if (!user) throw new Error(`No user with email ${email}`);

    await users.unlock(user.id);
    await get(MfaService).reset(user.id);
    await get(TokenService).revokeAllForUser(user.id);
    if (password) await get(AuthService).forceSetPassword(user.id, password);
    await get(RbacService).invalidateAuthUser(user.id);

    const actions = ['unlock', 'mfa_reset', 'sessions_revoked'];
    if (password) actions.push('password_set');
    await get(AuditService).record({
      actorUserId: null,
      action: 'user.break_glass',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { via: 'cli', host: hostname(), actions },
    });

    console.log(
      `Recovered ${email}: ${actions.join(', ')}.` +
        (password
          ? ' They can sign in with the new password and must re-enrol MFA.'
          : ' Their password is unchanged; use "Forgot password" if needed, then re-enrol MFA.'),
    );
  } finally {
    await app.close();
  }
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
