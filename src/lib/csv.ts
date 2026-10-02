import { parseAmount } from './money';
import { ISODate, isValidISO } from './dates';

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export interface ColumnMapping {
  date: number;
  description: number;
  amount?: number;
  debit?: number;
  credit?: number;
}

const find = (header: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
};

export function detectColumns(header: string[]): ColumnMapping | null {
  const date = find(header, /^(transaction |posted |post )?date$/i, /date/i);
  const description = find(header, /^description$/i, /description|payee|merchant|name|memo|details/i);
  const amount = find(header, /^amount$/i, /amount/i);
  const debit = find(header, /debit|withdrawal|money out/i);
  const credit = find(header, /credit|deposit|money in/i);
  if (date < 0 || description < 0) return null;
  if (debit >= 0 && credit >= 0) return { date, description, debit, credit };
  if (amount >= 0) return { date, description, amount };
  return null;
}

/** Accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YY. */
export function parseDate(s: string): ISODate | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return iso && isValidISO(iso) ? iso : null;
}

export interface ParsedRow {
  date: ISODate;
  description: string;
  amount: number;
}

/**
 * Converts CSV rows to transactions. `invert` flips signs for exports where purchases are
 * positive (common for credit card CSVs).
 */
export function rowsToTransactions(
  rows: string[][],
  mapping: ColumnMapping,
  opts: { invert?: boolean } = {},
): { parsed: ParsedRow[]; skipped: number } {
  const parsed: ParsedRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const date = parseDate(r[mapping.date] ?? '');
    const description = (r[mapping.description] ?? '').trim();
    let amount: number | null = null;
    if (mapping.amount != null) amount = parseAmount(r[mapping.amount] ?? '');
    else {
      const debit = parseAmount(r[mapping.debit!] ?? '') ?? 0;
      const credit = parseAmount(r[mapping.credit!] ?? '') ?? 0;
      amount = credit - Math.abs(debit);
      if (!r[mapping.debit!]?.trim() && !r[mapping.credit!]?.trim()) amount = null;
    }
    if (!date || !description || amount == null) {
      skipped++;
      continue;
    }
    parsed.push({ date, description, amount: opts.invert ? -amount : amount });
  }
  return { parsed, skipped };
}

/** Stable id so re-importing the same file does not duplicate rows. */
export function csvTransactionId(accountId: string, row: ParsedRow, dupIndex: number): string {
  const s = `${accountId}|${row.date}|${row.amount}|${row.description}|${dupIndex}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `csv:${accountId}:${(h >>> 0).toString(36)}`;
}
