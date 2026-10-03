import { describe, expect, it, vi } from 'vitest';
import { handle, Env } from '../handler';

const env: Env = { PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec', APP_SECRET: 'app', ANDROID_PACKAGE_NAME: 'com.x' };

const req = (path: string, body?: object, auth = 'Bearer app') =>
  new Request(`https://w.dev${path}`, { method: 'POST', headers: { Authorization: auth }, body: body ? JSON.stringify(body) : undefined });

/** Fake Plaid: routes by path to canned responses, records calls. */
function fakePlaid(routes: Record<string, (body: Record<string, unknown>) => [number, object]>) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body));
    calls.push({ path, body });
    const [status, data] = routes[path](body);
    return new Response(JSON.stringify(data), { status });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('worker', () => {
  it('rejects requests without the app secret', async () => {
    const res = await handle(req('/link-token', {}, 'Bearer nope'), env);
    expect(res.status).toBe(401);
  });

  it('creates a link token with transactions + optional liabilities', async () => {
    const p = fakePlaid({ '/link/token/create': () => [200, { link_token: 'lt' }] });
    const res = await handle(req('/link-token', {}), env, p.fn);
    expect(await res.json()).toEqual({ linkToken: 'lt' });
    expect(p.calls[0].body).toMatchObject({
      client_id: 'cid', secret: 'sec', products: ['transactions'], optional_products: ['liabilities'], android_package_name: 'com.x',
    });
  });

  it('uses update mode when an access token is given', async () => {
    const p = fakePlaid({ '/link/token/create': () => [200, { link_token: 'lt' }] });
    await handle(req('/link-token', { accessToken: 'at' }), env, p.fn);
    expect(p.calls[0].body.access_token).toBe('at');
    expect(p.calls[0].body.products).toBeUndefined();
  });

  it('pages through sync and trims the response', async () => {
    const txn = (id: string) => ({
      transaction_id: id, account_id: 'a1', amount: 12.5, date: '2026-10-01', authorized_date: '2026-09-30', name: 'NETFLIX',
      merchant_name: 'Netflix', pending: false, personal_finance_category: { primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_TV_AND_MOVIES' },
    });
    const p = fakePlaid({
      '/transactions/sync': (b) =>
        b.cursor === undefined
          ? [200, { added: [txn('t1')], modified: [], removed: [], next_cursor: 'c1', has_more: true }]
          : [200, { added: [txn('t2')], modified: [], removed: [{ transaction_id: 'old' }], next_cursor: 'c2', has_more: false }],
      '/accounts/get': () => [200, {
        accounts: [{ account_id: 'a1', name: 'Freedom', official_name: null, mask: '1234', type: 'credit', subtype: 'credit card', balances: { current: 900, available: 4100, limit: 5000 } }],
      }],
      '/liabilities/get': () => [200, {
        liabilities: { credit: [{ account_id: 'a1', last_statement_balance: 850, last_statement_issue_date: '2026-09-20', minimum_payment_amount: 35, next_payment_due_date: '2026-10-15', aprs: [{ apr_type: 'cash_apr', apr_percentage: 29.99 }, { apr_type: 'purchase_apr', apr_percentage: 24.99 }] }] },
      }],
    });
    const res = await handle(req('/sync', { accessToken: 'at', cursor: null }), env, p.fn);
    const data = await res.json();
    expect(data.added.map((t: { id: string }) => t.id)).toEqual(['t1', 't2']);
    expect(data.removed).toEqual(['old']);
    expect(data.nextCursor).toBe('c2');
    expect(data.added[0]).toMatchObject({ merchantName: 'Netflix', category: 'ENTERTAINMENT', authorizedDate: '2026-09-30' });
    expect(data.accounts[0]).toMatchObject({ id: 'a1', type: 'credit', current: 900, limit: 5000 });
    expect(data.liabilities[0]).toEqual({
      accountId: 'a1', lastStatementBalance: 850, lastStatementIssueDate: '2026-09-20', minimumPaymentAmount: 35, nextPaymentDueDate: '2026-10-15', purchaseApr: 24.99,
    });
  });

  it('restarts pagination on mutation errors and tolerates missing liabilities', async () => {
    let calls = 0;
    const p = fakePlaid({
      '/transactions/sync': () => {
        calls++;
        if (calls === 2) return [400, { error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', error_type: 'TRANSACTIONS_ERROR' }];
        return calls === 1
          ? [200, { added: [], modified: [], removed: [], next_cursor: 'x', has_more: true }]
          : [200, { added: [], modified: [], removed: [], next_cursor: 'done', has_more: false }];
      },
      '/accounts/get': () => [200, { accounts: [{ account_id: 'a', name: 'Card', official_name: null, mask: null, type: 'credit', subtype: null, balances: { current: 1, available: null, limit: null } }] }],
      '/liabilities/get': () => [400, { error_code: 'PRODUCTS_NOT_SUPPORTED', error_type: 'ITEM_ERROR' }],
    });
    const data = await (await handle(req('/sync', { accessToken: 'at' }), env, p.fn)).json();
    expect(data.nextCursor).toBe('done');
    expect(data.liabilities).toBeNull();
  });

  it('passes Plaid errors through with their code', async () => {
    const p = fakePlaid({
      '/transactions/sync': () => [400, { error_code: 'ITEM_LOGIN_REQUIRED', error_type: 'ITEM_ERROR', display_message: 'Log in again' }],
    });
    const res = await handle(req('/sync', { accessToken: 'at' }), env, p.fn);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ITEM_LOGIN_REQUIRED', message: 'Log in again' });
  });
});
