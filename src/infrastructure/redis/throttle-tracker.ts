import { JwtService } from '@nestjs/jwt';

/**
 * Rate-limit bucket per caller: the user id for requests with a valid access
 * token (so an office behind one NAT doesn't share a single limit), the IP
 * otherwise (login, password reset, anonymous). Only verified tokens count —
 * a forged `sub` can't be used to dodge the IP bucket.
 */
export function throttleTracker(...secrets: (string | undefined)[]) {
  const jwt = new JwtService();
  const keys = secrets.filter((s): s is string => !!s);
  return (req: Record<string, unknown>): string => {
    const header = (req.headers as Record<string, string | undefined>)
      ?.authorization;
    const [scheme, token] = (header ?? '').split(' ');
    if (scheme?.toLowerCase() === 'bearer' && token) {
      for (const secret of keys) {
        try {
          return `user:${jwt.verify<{ sub: string }>(token, { secret }).sub}`;
        } catch {
          // invalid / expired with this key → next key, then the IP
        }
      }
    }
    return `ip:${String(req.ip)}`;
  };
}
