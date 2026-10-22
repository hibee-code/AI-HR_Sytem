/**
 * Column default for a jsonb literal, rendered the way Postgres prints jsonb
 * (keys ordered by length then bytewise, ", " and ": " separators). TypeORM
 * compares defaults as text, so a plain JSON.stringify shows up as schema
 * drift on every migration:generate. ASCII keys assumed.
 */
export function jsonbDefault(value: unknown): () => string {
  const literal = renderJsonb(value).replace(/'/g, "''");
  return () => `'${literal}'`;
}

export function renderJsonb(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(renderJsonb).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    entries.sort(
      ([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${renderJsonb(v)}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}
