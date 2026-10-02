import { describe, expect, it } from 'vitest';
import { parseCSV, detectColumns, rowsToTransactions, parseDate, csvTransactionId } from '../csv';
import { parseAmount } from '../money';

describe('csv', () => {
  it('parses quoted fields', () => {
    expect(parseCSV('a,b\r\n"x, y","say ""hi"""\n\n1,2')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '2'],
    ]);
  });
  it('detects amount or debit/credit columns', () => {
    expect(detectColumns(['Transaction Date', 'Post Date', 'Description', 'Category', 'Type', 'Amount'])).toEqual({ date: 0, description: 2, amount: 5 });
    expect(detectColumns(['Date', 'Description', 'Debit', 'Credit'])).toEqual({ date: 0, description: 1, debit: 2, credit: 3 });
    expect(detectColumns(['foo'])).toBeNull();
  });
  it('converts rows', () => {
    const rows = [
      ['10/01/2026', 'COFFEE', '-4.50'],
      ['2026-10-02', 'PAYCHECK', '$1,200.00'],
      ['bad', 'X', '1'],
    ];
    const { parsed, skipped } = rowsToTransactions(rows, { date: 0, description: 1, amount: 2 });
    expect(parsed).toEqual([
      { date: '2026-10-01', description: 'COFFEE', amount: -4.5 },
      { date: '2026-10-02', description: 'PAYCHECK', amount: 1200 },
    ]);
    expect(skipped).toBe(1);
    const dc = rowsToTransactions([['1/5/26', 'X', '20.00', '']], { date: 0, description: 1, debit: 2, credit: 3 });
    expect(dc.parsed[0].amount).toBe(-20);
  });
  it('parses helpers', () => {
    expect(parseDate('2/30/2026')).toBeNull();
    expect(parseAmount('(12.50)')).toBe(-12.5);
    expect(parseAmount('12.50-')).toBe(-12.5);
    expect(parseAmount('abc')).toBeNull();
    const row = { date: '2026-10-01', description: 'A', amount: -1 };
    expect(csvTransactionId('acc', row, 0)).toBe(csvTransactionId('acc', row, 0));
    expect(csvTransactionId('acc', row, 0)).not.toBe(csvTransactionId('acc', row, 1));
  });
});
