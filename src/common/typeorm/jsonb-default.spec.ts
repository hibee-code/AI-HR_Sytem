import { jsonbDefault, renderJsonb } from './jsonb-default';

describe('renderJsonb', () => {
  it('orders keys like Postgres jsonb (length, then bytewise)', () => {
    expect(renderJsonb({ value: 1, label: 'x', id: 'a', b: true })).toBe(
      '{"b": true, "id": "a", "label": "x", "value": 1}',
    );
  });

  it('renders arrays, nesting, null and drops undefined', () => {
    expect(renderJsonb([{ a: [1, 2], z: null, u: undefined }, 'x'])).toBe(
      '[{"a": [1, 2], "z": null}, "x"]',
    );
  });

  it('wraps as a SQL literal and escapes single quotes', () => {
    expect(jsonbDefault([{ label: "Don't" }])()).toBe(
      `'[{"label": "Don''t"}]'`,
    );
  });
});
