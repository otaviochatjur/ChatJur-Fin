export type PayoutPeriodWindow = {
  competencePeriod: string;
  start: string;
  cutoff: string;
  endExclusive: string;
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * A repasse reference month closes on day 30 of the previous month. When
 * that month has fewer than 30 days, its last calendar day is the cutoff.
 */
export function payoutPeriodWindow(referencePeriod: string): PayoutPeriodWindow {
  if (!/^\d{4}-\d{2}$/.test(referencePeriod)) throw new Error("Período inválido.");
  const [year, month] = referencePeriod.split("-").map(Number);
  if (month < 1 || month > 12) throw new Error("Período inválido.");

  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const previousYear = previousMonth.getUTCFullYear();
  const previousMonthIndex = previousMonth.getUTCMonth();
  const competencePeriod = `${previousYear}-${String(previousMonthIndex + 1).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(previousYear, previousMonthIndex + 1, 0)).getUTCDate();
  const cutoffDay = Math.min(30, lastDay);
  const cutoffDate = new Date(Date.UTC(previousYear, previousMonthIndex, cutoffDay));
  const endExclusiveDate = new Date(cutoffDate);
  endExclusiveDate.setUTCDate(endExclusiveDate.getUTCDate() + 1);

  return {
    competencePeriod,
    start: `${competencePeriod}-01`,
    cutoff: isoDate(cutoffDate),
    endExclusive: isoDate(endExclusiveDate),
  };
}
