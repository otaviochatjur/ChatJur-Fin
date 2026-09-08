export type ReportMode = "DAILY" | "OPEN" | "ALL";
export const reportModeLabels = { DAILY: "Régua do dia", OPEN: "Vencidas e a vencer", ALL: "Todas as cobranças" };
export type CollectionReport = {
  source_cursor?: string | null;
  source_generation?: string | null; source_updated_at?: string | null;
  rule_config: import("./collection-rules").CollectionSettings;
  id: string; mode: ReportMode; report_date: string; status: "RUNNING" | "COMPLETE";
  phase: number; page_offset: number; processed: number; row_count: number;
  error: string | null; created_at: string; completed_at: string | null;
};
export type ReportSnapshot = {
  payment_id: string; customer_id: string; name: string; email: string; phone: string;
  status: string; value: number; due_date: string | null; description: string; billing_type: string;
  days: number | null; stage: string | null; trigger: number | null; nominal: string | null; effective: string | null;
  invoice_url: string | null; bankslip_url: string | null; pix_payload: string | null; pix_image: string | null; pix_expiration: string | null;
  warnings: string[];
};
export type ReportRow = {
  id: string; report_id: string; asaas_payment_id: string; snapshot: ReportSnapshot;
  customer_found?: boolean;
  customer_status?: "ACTIVE" | "CANCELLED" | "FROZEN" | null;
};
