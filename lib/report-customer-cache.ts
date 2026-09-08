/** Short-lived, bounded cache shared only within one tenant's report execution. */
export class ReportCustomerCache<T> {
  private reports = new Map<string, { touched: number; customers: Map<string, Promise<T>> }>();
  constructor(private ttlMs = 15 * 60_000, private maxReports = 10, private maxCustomers = 5000, private now = () => Date.now()) {}
  async get(scope: string, customerId: string, read: () => Promise<T>): Promise<T> {
    const now = this.now();
    for (const [key, report] of this.reports) if (now - report.touched >= this.ttlMs) this.reports.delete(key);
    let report = this.reports.get(scope);
    if (!report) {
      while (this.reports.size >= this.maxReports) this.reports.delete(this.reports.keys().next().value!);
      report = { touched: now, customers: new Map() };
    }
    report.touched = now;
    this.reports.delete(scope); this.reports.set(scope, report);
    const cached = report.customers.get(customerId);
    if (cached) return cached;
    while (report.customers.size >= this.maxCustomers) report.customers.delete(report.customers.keys().next().value!);
    const pending = read();
    report.customers.set(customerId, pending);
    try { return await pending; }
    catch (error) { if (report.customers.get(customerId) === pending) report.customers.delete(customerId); throw error; }
  }
  clear(scope: string) { this.reports.delete(scope); }
}

/** Workers immediately pick the next item instead of waiting for the slowest item in each batch. */
export async function parallelReportItems<T, R>(items: T[], action: (item: T) => Promise<R>, concurrency = 5) {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await action(items[index]); }
  }));
  return result;
}
