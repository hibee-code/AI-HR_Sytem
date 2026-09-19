import type { ValueTransformer } from 'typeorm';

/** Postgres `numeric` comes back as a string; store/read it as a JS number. */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
