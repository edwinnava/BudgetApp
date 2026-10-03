import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from './nodeDb';

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void store.set(k, v),
  deleteItemAsync: async (k: string) => void store.delete(k),
}));

const { migrate } = await import('../../db/schema');
const { syncPlaid } = await import('../plaid');
const { listCards, listCardPayments, listTransactions } = await import('../../db/repo');

const card = { id: 'card1', name: 'Freedom Unlimited', officialName: null, mask: '4321', type: 'credit', subtype: 'credit card', current: 1250.5, available: 3749.5, limit: 5000 };
const checking = { id: 'chk1', name: 'Total Checking', officialName: null, mask: '1111', type: 'depository', subtype: 'checking', current: 2400, available: 2400, limit: null };
const txn = (id: string, accountId: string, amount: number, name: string, extra: object = {}) => ({
  id, accountId, amount, date: '2026-09-28', authorizedDate: null, name, merchantName: null, pending: false,
  pendingTransactionId: null, category: null, detailedCategory: null, ...extra,
});

function mockWorker(responses: object[]) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

describe('Plaid sync into the local database', () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(async () => {
    store.clear();
    store.set('plaid_server_url', 'https://w.dev');
    store.set('plaid_app_secret', 's');
    store.set('plaid_token_item1', 'access-1');
    db = createTestDb();
    await migrate(db);
    await db.runAsync("INSERT INTO plaid_items (item_id, institution) VALUES ('item1', 'Chase')");
  });

  it('creates accounts, card details, categorized transactions and card payments', async () => {
    const bodies = mockWorker([
      {
        accounts: [card, checking],
        added: [
          txn('t1', 'card1', 54.2, 'WHOLE FOODS', { category: 'FOOD_AND_DRINK', detailedCategory: 'FOOD_AND_DRINK_GROCERIES' }),
          txn('t2', 'card1', -500, 'AUTOMATIC PAYMENT - THANK', { category: 'LOAN_PAYMENTS', detailedCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }),
          txn('t3', 'chk1', 500, 'CHASE CREDIT CRD AUTOPAY', { category: 'LOAN_PAYMENTS', detailedCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }),
          txn('t4', 'card1', 15.49, 'Netflix', { pending: true, category: 'ENTERTAINMENT' }),
        ],
        modified: [],
        removed: [],
        nextCursor: 'cursor-1',
        liabilities: [{ accountId: 'card1', lastStatementBalance: 980, lastStatementIssueDate: '2026-09-18', minimumPaymentAmount: 40, nextPaymentDueDate: '2026-10-15', purchaseApr: 24.99 }],
      },
    ]);
    const r = await syncPlaid(db);
    expect(r.errors).toEqual([]);
    expect(bodies[0]).toEqual({ accessToken: 'access-1', cursor: null });

    const [k] = await listCards(db);
    expect(k).toMatchObject({
      id: 'plaid:card1', name: 'Freedom Unlimited ••4321', institution: 'Chase', balance: -1250.5, owed: 1250.5,
      statement_balance: 980, statement_day: 18, due_day: 15, min_payment: 40, apr: 24.99, credit_limit: 5000,
    });

    const txns = await listTransactions(db);
    const byId = Object.fromEntries(txns.map((t) => [t.id, t]));
    expect(byId['plaid:t1']).toMatchObject({ amount: -54.2, category_name: 'Groceries' });
    expect(byId['plaid:t2']).toMatchObject({ amount: 500, category_name: 'Credit Card Payment' });
    expect(byId['plaid:t3']).toMatchObject({ amount: -500, category_name: 'Credit Card Payment' });
    expect(byId['plaid:t4']).toMatchObject({ category_name: 'Subscriptions', pending: 1 });

    // Only the card-side payment counts, so paying a card is never double counted.
    const payments = await listCardPayments(db);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ card_account_id: 'plaid:card1', amount: 500, transaction_id: 'plaid:t2' });

    const item = await db.getFirstAsync<{ cursor: string; error: string | null }>("SELECT cursor, error FROM plaid_items");
    expect(item).toEqual({ cursor: 'cursor-1', error: null });
  });

  it('keeps user edits: categories survive pending->posted, typed card details are not wiped', async () => {
    mockWorker([
      { accounts: [card], added: [txn('p1', 'card1', 30, 'LOCAL DINER', { pending: true })], modified: [], removed: [], nextCursor: 'c1', liabilities: null },
      {
        accounts: [{ ...card, current: 1300 }],
        added: [txn('t9', 'card1', 31.5, 'LOCAL DINER', { pendingTransactionId: 'p1' })],
        modified: [], removed: ['p1'], nextCursor: 'c2', liabilities: null,
      },
    ]);
    await syncPlaid(db);
    const travel = await db.getFirstAsync<{ id: number }>("SELECT id FROM categories WHERE name = 'Travel'");
    await db.runAsync("UPDATE transactions SET category_id = ?, notes = 'road trip' WHERE id = 'plaid:p1'", travel!.id);
    await db.runAsync("UPDATE card_details SET apr = 21.5, due_day = 3 WHERE account_id = 'plaid:card1'");

    await syncPlaid(db);
    const txns = await listTransactions(db);
    expect(txns.map((t) => t.id)).toEqual(['plaid:t9']);
    expect(txns[0]).toMatchObject({ category_name: 'Travel', notes: 'road trip', amount: -31.5 });
    const [k] = await listCards(db);
    expect(k).toMatchObject({ apr: 21.5, due_day: 3, owed: 1300, credit_limit: 5000 });
  });

  it('flags logins that need re-authentication', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'ITEM_LOGIN_REQUIRED', message: 'Log in again' }), { status: 400 }),
    ) as unknown as typeof fetch;
    const r = await syncPlaid(db);
    expect(r.errors[0]).toContain('Chase: needs you to log in again');
    expect(await db.getFirstAsync("SELECT error FROM plaid_items")).toEqual({ error: 'ITEM_LOGIN_REQUIRED' });
  });
});
