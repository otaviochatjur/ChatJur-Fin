// Matches the PUBLIC national calendar used by holidays.country_holidays("BR").
export function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
export function isCollectionHoliday(date: string) {
  const value = new Date(`${date}T00:00:00Z`), year = value.getUTCFullYear();
  if (!Number.isFinite(value.getTime())) return false;
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "12-25", ...(year >= 2024 ? ["11-20"] : [])];
  return fixed.includes(date.slice(5)) || date === addCalendarDays(easter(year), -2);
}
export type CollectionCalendar = { saturday: boolean; sunday: boolean; holidays: boolean };
export function isCollectionBusinessDay(date: string, calendar: CollectionCalendar = { saturday: false, sunday: false, holidays: false }) {
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime())) return false;
  return (value.getUTCDay() !== 6 || calendar.saturday) && (value.getUTCDay() !== 0 || calendar.sunday) && (!isCollectionHoliday(date) || calendar.holidays);
}
export function nextCollectionBusinessDay(date: string, calendar?: CollectionCalendar) {
  let next = date;
  for (let i = 0; i < 15; i++) { if (isCollectionBusinessDay(next, calendar)) return next; next = addCalendarDays(next, 1); }
  throw new Error("Data inválida para a régua.");
}
