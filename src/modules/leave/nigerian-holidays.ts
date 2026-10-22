import { addDays } from '../../common/utils/date';

/**
 * Nigerian public holidays computable in advance: the fixed-date ones and
 * the Easter-based ones. Eid-el-Fitr, Eid-el-Kabir and Eid-el-Maulud follow
 * the lunar calendar and are declared by the Federal Government each year,
 * as are any weekend substitutes — add those by hand when announced.
 */
export function nigerianPublicHolidays(
  year: number,
): { date: string; name: string }[] {
  const d = (m: number, day: number) =>
    `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const easter = easterSunday(year);
  return [
    { date: d(1, 1), name: "New Year's Day" },
    { date: addDays(easter, -2), name: 'Good Friday' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: d(5, 1), name: "Workers' Day" },
    { date: d(6, 12), name: 'Democracy Day' },
    { date: d(10, 1), name: 'Independence Day' },
    { date: d(12, 25), name: 'Christmas Day' },
    { date: d(12, 26), name: 'Boxing Day' },
  ].sort((a, b) => a.date.localeCompare(b.date));
}

export const DECLARED_HOLIDAYS_NOTE =
  'Eid-el-Fitr, Eid-el-Kabir, Eid-el-Maulud and any weekend substitutes are declared by the Federal Government each year — add them with POST /leave/holidays once announced.';

/** Gregorian Easter Sunday (Anonymous / Meeus–Jones–Butcher algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
