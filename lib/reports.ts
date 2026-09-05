/**
 * Client-side report generation for the "Repasses" tab: branded PDF (jsPDF +
 * jspdf-autotable) and real .xlsx workbooks (SheetJS `xlsx`), both built
 * entirely in the browser — no server round trip, no extra backend.
 *
 * Visual identity pulled from https://chatjuridico.com.br/identidade-visual/
 * (the official brand kit): primary corporate blue, semantic colors, and the
 * horizontal logo (cached locally at /public/brand so exports don't depend
 * on the marketing site being reachable).
 */
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export const BRAND = {
  primary: "#3a5d9d", // Azul Corporativo — official primary
  primaryRgb: [58, 93, 157] as [number, number, number],
  success: "#10b981",
  successRgb: [16, 185, 129] as [number, number, number],
  warning: "#f59e0b",
  warningRgb: [245, 158, 11] as [number, number, number],
  danger: "#ef4444",
  dangerRgb: [239, 68, 68] as [number, number, number],
  neutralRgb: [226, 232, 240] as [number, number, number],
  stripeRgb: [246, 249, 253] as [number, number, number],
  darkGrayRgb: [108, 117, 125] as [number, number, number],
  inkRgb: [15, 23, 42] as [number, number, number],
  logoPath: "/brand/chat-juridico-logo.svg",
  // Original SVG viewBox is 4937x1323 (~3.7315:1) — used to keep the raster proportional.
  logoAspect: 4937 / 1323,
};

/**
 * Rasterizes an SVG (served same-origin from /public) into a PNG data URL
 * via a canvas — jsPDF's addImage doesn't understand SVG directly. Cached
 * per URL for the lifetime of the tab so repeated exports (PDF + Excel,
 * accounting + per-partner) don't redo the work.
 */
const logoCache = new Map<string, Promise<string | null>>();

function rasterizeSvg(url: string, targetWidthPx = 900): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") { resolve(null); return; }
    const img = new Image();
    img.onload = () => {
      const scale = targetWidthPx / (img.width || targetWidthPx);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidthPx;
      canvas.height = Math.max(1, Math.round((img.height || targetWidthPx / BRAND.logoAspect) * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try { resolve(canvas.toDataURL("image/png")); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Loads (and caches) the official Chat Jurídico horizontal logo as a PNG data URL, ready for `doc.addImage`. */
export function loadBrandLogo(): Promise<string | null> {
  if (!logoCache.has(BRAND.logoPath)) logoCache.set(BRAND.logoPath, rasterizeSvg(BRAND.logoPath, 900));
  return logoCache.get(BRAND.logoPath)!;
}

export type PdfTableReport = {
  title: string;
  subtitle?: string;
  /** Small red flag printed under the header, e.g. "AMOSTRA — DADOS FICTÍCIOS". */
  banner?: string;
  columns: string[];
  rows: (string | number)[][];
  /** 0-based column indexes to right-align (money/number columns). */
  rightAlignColumns?: number[];
  totalsRow?: (string | number)[];
  /** Small italic note printed after the table (e.g. explaining the commission methodology). */
  footNote?: string;
  filename: string;
};

/** Builds and downloads a branded PDF report (logo, brand colors, page numbers, generation timestamp). */
export async function downloadBrandedPdf(report: PdfTableReport) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  const logo = await loadBrandLogo();

  if (logo) {
    const logoW = 118;
    const logoH = logoW / BRAND.logoAspect;
    doc.addImage(logo, "PNG", marginX, 22, logoW, logoH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...BRAND.inkRgb);
  doc.text(report.title, pageWidth - marginX, 34, { align: "right" });

  if (report.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND.darkGrayRgb);
    doc.text(report.subtitle, pageWidth - marginX, 48, { align: "right" });
  }

  doc.setDrawColor(...BRAND.primaryRgb);
  doc.setLineWidth(1.4);
  doc.line(marginX, 66, pageWidth - marginX, 66);

  let startY = 82;
  if (report.banner) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND.dangerRgb);
    doc.text(report.banner, marginX, 78);
    startY = 92;
  }

  autoTable(doc, {
    startY,
    head: [report.columns],
    body: report.rows,
    foot: report.totalsRow ? [report.totalsRow] : undefined,
    margin: { left: marginX, right: marginX, top: 40, bottom: 56 },
    styles: { font: "helvetica", fontSize: 8.5, textColor: BRAND.inkRgb, cellPadding: 5, lineColor: BRAND.neutralRgb, lineWidth: 0.5 },
    headStyles: { fillColor: BRAND.primaryRgb, textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
    footStyles: { fillColor: BRAND.neutralRgb, textColor: BRAND.inkRgb, fontStyle: "bold" },
    alternateRowStyles: { fillColor: BRAND.stripeRgb },
    columnStyles: Object.fromEntries((report.rightAlignColumns ?? []).map((index) => [index, { halign: "right" as const }])),
  });

  type WithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };
  const finalY = (doc as WithAutoTable).lastAutoTable?.finalY ?? startY;
  if (report.footNote) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.darkGrayRgb);
    doc.text(report.footNote, marginX, finalY + 16, { maxWidth: pageWidth - marginX * 2 });
  }

  // Footer (generated-at + page numbers) is added last, after pagination is final.
  const pageCount = doc.getNumberOfPages();
  const generatedAt = new Date().toLocaleString("pt-BR");
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    const pageSize = doc.internal.pageSize;
    const footY = pageSize.getHeight() - 28;
    doc.setDrawColor(...BRAND.neutralRgb);
    doc.setLineWidth(0.6);
    doc.line(marginX, footY - 10, pageSize.getWidth() - marginX, footY - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.darkGrayRgb);
    doc.text(`Chat Jurídico · Relatório gerado em ${generatedAt}`, marginX, footY);
    doc.text(`Página ${page} de ${pageCount}`, pageSize.getWidth() - marginX, footY, { align: "right" });
  }

  doc.save(report.filename);
}

export type XlsxSheet = {
  name: string;
  title?: string;
  subtitle?: string;
  columns: string[];
  rows: (string | number)[][];
  totalsRow?: (string | number)[];
};

function sanitizeSheetName(name: string) {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Planilha";
}

/** Builds and downloads a real .xlsx workbook (one sheet per entry), with a lightweight title/subtitle header row per sheet. */
export function downloadBrandedXlsx(filename: string, sheets: XlsxSheet[]) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const aoa: (string | number)[][] = [];
    if (sheet.title) aoa.push([sheet.title]);
    if (sheet.subtitle) aoa.push([sheet.subtitle]);
    if (sheet.title || sheet.subtitle) aoa.push([]);
    const headerRowIndex = aoa.length;
    aoa.push(sheet.columns);
    aoa.push(...sheet.rows);
    if (sheet.totalsRow) aoa.push(sheet.totalsRow);

    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet["!cols"] = sheet.columns.map((column, index) => ({
      wch: Math.max(12, column.length + 2, ...sheet.rows.map((row) => String(row[index] ?? "").length + 2)),
    }));
    if (sheet.title) worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, sheet.columns.length - 1) } }];
    void headerRowIndex;
    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeSheetName(sheet.name));
  }
  XLSX.writeFile(workbook, filename);
}

/**
 * Client-side CSV export helper (kept for any future lightweight export
 * needs) — semicolon-delimited so pt-BR Excel doesn't mangle "R$ 1.234,56"
 * money columns, with a UTF-8 BOM so accented characters render correctly.
 */
function csvEscape(value: string) {
  if (/["";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content = rows.map((row) => row.map((cell) => csvEscape(String(cell))).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Deterministic PRNG seeded from a string (e.g. an actor's id) — used to
 * generate "fictitious data" demo reports that stay stable across repeated
 * clicks instead of reshuffling every time, which makes it easier to sanity
 * check the report layout.
 */
export function seededRandom(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) { h = Math.imul(h ^ seed.charCodeAt(i), 16777619); h >>>= 0; }
  let state = h;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
