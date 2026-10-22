import { addDays, todayIso } from '../../src/common/utils/date';

/**
 * Date choices for e2e tests that must hold on every day of the year:
 * leave requests can't cross 31 December, so windows stay in one year.
 */

const isMonday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;
const year = (iso: string) => iso.slice(0, 4);

/**
 * First Monday at least 7 days out whose following `spanDays` stay in the
 * same calendar year (late December rolls into January).
 */
export function futureMonday(spanDays = 31, today = todayIso()): string {
  let d = addDays(today, 7);
  while (!isMonday(d) || year(d) !== year(addDays(d, spanDays)))
    d = addDays(d, 1);
  return d;
}

/**
 * A leave of `days` calendar days that has already started and is still
 * running today, inside the current calendar year.
 */
export function inProgressSpan(
  days = 35,
  today = todayIso(),
): { start: string; end: string } {
  const jan1 = `${year(today)}-01-01`;
  const dec31 = `${year(today)}-12-31`;
  let start = addDays(today, -14) < jan1 ? jan1 : addDays(today, -14);
  let end = addDays(start, days - 1);
  if (end > dec31) {
    end = dec31;
    start = addDays(end, -(days - 1));
  }
  return { start, end };
}
