import { describe, expect, it } from 'vitest';
import { accountBalance, cardDetailsFromPlaid, mapAccountType, mapTransaction, plaidCategoryName, PlaidAccount } from '../plaidMap';

const acct = (over: Partial<PlaidAccount>): PlaidAccount => ({
  id: 'a', name: 'Acct', officialName: null, mask: '1234', type: 'depository', subtype: 'checking', current: 100, available: 90, limit: null, ...over,
});

describe('plaidMap', () => {
  it('maps account types and balances', () => {
    expect(mapAccountType('depository', 'savings')).toBe('savings');
    expect(mapAccountType('depository', 'checking')).toBe('checking');
    expect(mapAccountType('credit', 'credit card')).toBe('credit');
    expect(mapAccountType('investment', 'brokerage')).toBe('investment');
    expect(accountBalance(acct({ type: 'credit', subtype: 'credit card', current: 900 }))).toBe(-900);
    expect(accountBalance(acct({}))).toBe(100);
  });

  it('maps categories', () => {
    expect(plaidCategoryName('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES', -50, 'credit')).toBe('Groceries');
    expect(plaidCategoryName('FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT', -50, 'credit')).toBe('Dining');
    expect(plaidCategoryName('LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', -500, 'checking')).toBe('Credit Card Payment');
    expect(plaidCategoryName('TRANSFER_IN', 'TRANSFER_IN_ACCOUNT_TRANSFER', 500, 'credit')).toBe('Credit Card Payment');
    expect(plaidCategoryName('TRANSFER_IN', 'TRANSFER_IN_ACCOUNT_TRANSFER', 500, 'checking')).toBe('Transfer');
    expect(plaidCategoryName('INCOME', 'INCOME_WAGES', 2000, 'checking')).toBe('Income');
    expect(plaidCategoryName(null, null, -1, 'checking')).toBeNull();
  });

  it('flips amounts and links pending transactions', () => {
    const m = mapTransaction(
      { id: 't2', accountId: 'a', amount: 12.5, date: '2026-10-02', authorizedDate: '2026-10-01', name: 'SQ *BLUE BOTTLE', merchantName: 'Blue Bottle Coffee', pending: false, pendingTransactionId: 't1', category: 'FOOD_AND_DRINK', detailedCategory: 'FOOD_AND_DRINK_COFFEE' },
      'credit',
    );
    expect(m).toEqual({ id: 'plaid:t2', date: '2026-10-01', amount: -12.5, description: 'Blue Bottle Coffee', pending: false, hint: 'Dining', inheritFrom: 'plaid:t1' });
  });

  it('builds card details only from provided fields', () => {
    const card = acct({ type: 'credit', subtype: 'credit card', limit: 5000 });
    expect(cardDetailsFromPlaid(card, undefined)).toEqual({ credit_limit: 5000 });
    expect(
      cardDetailsFromPlaid(card, {
        accountId: 'a', lastStatementBalance: 850, lastStatementIssueDate: '2026-09-20', minimumPaymentAmount: 35, nextPaymentDueDate: '2026-10-15', purchaseApr: null,
      }),
    ).toEqual({ credit_limit: 5000, statement_balance: 850, statement_day: 20, due_day: 15, min_payment: 35 });
  });
});
