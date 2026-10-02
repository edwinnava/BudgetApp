import { describe, expect, it } from 'vitest';
import { guessCategory, normalizeMerchant, displayMerchant, looksLikeCardBillPayment } from '../categorize';

describe('normalizeMerchant', () => {
  it('strips noise', () => {
    expect(normalizeMerchant('NETFLIX.COM 866-579-7172 CA')).toBe('NETFLIX COM');
    expect(normalizeMerchant('Netflix.com')).toBe('NETFLIX COM');
    expect(normalizeMerchant('SQ *BLUE BOTTLE COFFEE #123')).toBe('BLUE BOTTLE COFFEE');
    expect(normalizeMerchant('SPOTIFY USA 877-778-1161 NY')).toBe('SPOTIFY USA');
    expect(normalizeMerchant('AMZN Mktp US*2A3B4C5D6')).toBe('AMZN MKTP');
    expect(normalizeMerchant('POS DEBIT TRADER JOE S #552 SEATTLE WA')).toBe('TRADER JOE SEATTLE');
  });
  it('displays nicely', () => {
    expect(displayMerchant('NETFLIX COM')).toBe('Netflix.com');
  });
});

describe('guessCategory', () => {
  it('uses keywords with word boundaries', () => {
    expect(guessCategory({ description: 'SHELL OIL 12345', amount: -40, accountType: 'credit' })).toBe('Transportation');
    expect(guessCategory({ description: 'CAESARS LAS VEGAS', amount: -40, accountType: 'credit' })).toBeNull();
    expect(guessCategory({ description: 'UBER *EATS', amount: -20, accountType: 'credit' })).toBe('Dining');
    expect(guessCategory({ description: 'CHICK-FIL-A #0234', amount: -9, accountType: 'credit' })).toBe('Dining');
  });
  it('detects card payments on both sides', () => {
    expect(guessCategory({ description: 'AUTOPAY PAYMENT - THANK YOU', amount: 500, accountType: 'credit' })).toBe('Credit Card Payment');
    expect(guessCategory({ description: 'CHASE CREDIT CRD AUTOPAY PPD ID: 123', amount: -500, accountType: 'checking' })).toBe('Credit Card Payment');
    expect(looksLikeCardBillPayment('AMEX EPAYMENT ACH PMT')).toBe(true);
    expect(looksLikeCardBillPayment('CHASE COFFEE')).toBe(false);
  });
  it('prefers user rules', () => {
    expect(
      guessCategory({ description: 'SHELL OIL', amount: -40, accountType: 'credit' }, [{ pattern: 'SHELL OIL', categoryName: 'Other' }]),
    ).toBe('Other');
  });
  it('treats deposits as income', () => {
    expect(guessCategory({ description: 'ACME CORP PAYROLL', amount: 2000, accountType: 'checking' })).toBe('Income');
    expect(guessCategory({ description: 'RANDOM', amount: 20, accountType: 'checking' })).toBe('Income');
  });
});
