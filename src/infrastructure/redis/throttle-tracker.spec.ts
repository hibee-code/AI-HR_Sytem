import { JwtService } from '@nestjs/jwt';
import { throttleTracker } from './throttle-tracker';

describe('throttleTracker', () => {
  const secret = 's'.repeat(32);
  const track = throttleTracker(secret);
  const req = (authorization?: string) => ({
    ip: '10.0.0.1',
    headers: authorization ? { authorization } : {},
  });

  it('buckets authenticated callers by user, so a shared NAT IP is not one bucket', () => {
    const a = new JwtService().sign({ sub: 'u-a' }, { secret });
    const b = new JwtService().sign({ sub: 'u-b' }, { secret });
    expect(track(req(`Bearer ${a}`))).toBe('user:u-a');
    expect(track(req(`Bearer ${b}`))).toBe('user:u-b');
  });

  it('falls back to the IP for anonymous or forged tokens', () => {
    const forged = new JwtService().sign(
      { sub: 'u-x' },
      { secret: 'x'.repeat(32) },
    );
    expect(track(req())).toBe('ip:10.0.0.1');
    expect(track(req(`Bearer ${forged}`))).toBe('ip:10.0.0.1');
    expect(track(req('Bearer not-a-jwt'))).toBe('ip:10.0.0.1');
  });
});
