import { easterSunday, nigerianPublicHolidays } from './nigerian-holidays';

describe('Nigerian public holidays', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'], // latest possible date
  ])('Easter Sunday %i is %s', (year, date) => {
    expect(easterSunday(year)).toBe(date);
  });

  it('2026: fixed dates plus Good Friday / Easter Monday, in date order', () => {
    expect(nigerianPublicHolidays(2026)).toEqual([
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-04-06', name: 'Easter Monday' },
      { date: '2026-05-01', name: "Workers' Day" },
      { date: '2026-06-12', name: 'Democracy Day' },
      { date: '2026-10-01', name: 'Independence Day' },
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-26', name: 'Boxing Day' },
    ]);
  });
});
