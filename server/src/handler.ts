/**
 * Tiny Plaid proxy. It holds the Plaid client secret (which must never ship inside the app)
 * and forwards a handful of calls. It stores nothing: the phone keeps each Item's access
 * token and sync cursor, and an access token is useless without the secret held here.
 */

export interface Env {
  PLAID_CLIENT_ID: string;
  PLAID_SECRET: string;
  /** Shared secret the app sends as a Bearer token so strangers can't use your Plaid account. */
  APP_SECRET: string;
  PLAID_ENV?: string; // "production" (default) or "sandbox"
  ANDROID_PACKAGE_NAME?: string;
}

type FetchFn = typeof fetch;

const HOSTS: Record<string, string> = {
  production: 'https://production.plaid.com',
  sandbox: 'https://sandbox.plaid.com',
};

export class PlaidApiError extends Error {
  constructor(
    public code: string,
    public type: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function plaid<T>(env: Env, fetchFn: FetchFn, path: string, body: object): Promise<T> {
  const host = HOSTS[env.PLAID_ENV ?? 'production'] ?? HOSTS.production;
  const res = await fetchFn(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlaidApiError(
      String(json.error_code ?? 'UNKNOWN'),
      String(json.error_type ?? 'API_ERROR'),
      String(json.display_message ?? json.error_message ?? `Plaid ${path} failed`),
      res.status,
    );
  }
  return json as T;
}

// ---------- trimmed response shapes sent to the app ----------

export interface SyncAccount {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current: number | null;
  available: number | null;
  limit: number | null;
}

export interface SyncTransaction {
  id: string;
  accountId: string;
  amount: number; // Plaid convention: positive = money out
  date: string;
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  pending: boolean;
  pendingTransactionId: string | null;
  category: string | null; // personal_finance_category.primary
  detailedCategory: string | null;
}

export interface SyncCardLiability {
  accountId: string;
  lastStatementBalance: number | null;
  lastStatementIssueDate: string | null;
  minimumPaymentAmount: number | null;
  nextPaymentDueDate: string | null;
  purchaseApr: number | null;
}

export interface SyncResponse {
  accounts: SyncAccount[];
  added: SyncTransaction[];
  modified: SyncTransaction[];
  removed: string[];
  nextCursor: string;
  liabilities: SyncCardLiability[] | null;
}

// ---------- raw Plaid shapes (only the fields we read) ----------

interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: { current: number | null; available: number | null; limit: number | null };
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date: string | null;
  name: string;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary: string; detailed: string } | null;
}

interface PlaidSyncPage {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
}

interface PlaidCreditLiability {
  account_id: string | null;
  last_statement_balance: number | null;
  last_statement_issue_date: string | null;
  minimum_payment_amount: number | null;
  next_payment_due_date: string | null;
  aprs: { apr_percentage: number; apr_type: string }[];
}

const trimTxn = (t: PlaidTransaction): SyncTransaction => ({
  id: t.transaction_id,
  accountId: t.account_id,
  amount: t.amount,
  date: t.date,
  authorizedDate: t.authorized_date ?? null,
  name: t.name,
  merchantName: t.merchant_name ?? null,
  pending: t.pending,
  pendingTransactionId: t.pending_transaction_id ?? null,
  category: t.personal_finance_category?.primary ?? null,
  detailedCategory: t.personal_finance_category?.detailed ?? null,
});

/** Errors that just mean "this Item has no card data", not a real failure. */
const NO_LIABILITIES = new Set(['PRODUCTS_NOT_SUPPORTED', 'NO_LIABILITY_ACCOUNTS', 'PRODUCT_NOT_READY', 'ADDITIONAL_CONSENT_REQUIRED', 'INVALID_PRODUCT']);

async function syncItem(env: Env, fetchFn: FetchFn, accessToken: string, cursor: string | null): Promise<SyncResponse> {
  let added: PlaidTransaction[] = [];
  let modified: PlaidTransaction[] = [];
  let removed: string[] = [];
  let next = cursor ?? undefined;

  // Page through /transactions/sync. If the data changes mid-pagination Plaid asks us to restart.
  for (let attempt = 0; ; attempt++) {
    try {
      added = [];
      modified = [];
      removed = [];
      next = cursor ?? undefined;
      for (let page = 0; page < 50; page++) {
        const r = await plaid<PlaidSyncPage>(env, fetchFn, '/transactions/sync', {
          access_token: accessToken,
          cursor: next,
          count: 500,
          options: { include_personal_finance_category: true },
        });
        added.push(...r.added);
        modified.push(...r.modified);
        removed.push(...r.removed.map((x) => x.transaction_id));
        next = r.next_cursor;
        if (!r.has_more) break;
      }
      break;
    } catch (e) {
      if (e instanceof PlaidApiError && e.code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 3) continue;
      throw e;
    }
  }

  const { accounts } = await plaid<{ accounts: PlaidAccount[] }>(env, fetchFn, '/accounts/get', { access_token: accessToken });

  let liabilities: SyncCardLiability[] | null = null;
  if (accounts.some((a) => a.type === 'credit')) {
    try {
      const r = await plaid<{ liabilities: { credit: PlaidCreditLiability[] | null } }>(env, fetchFn, '/liabilities/get', {
        access_token: accessToken,
      });
      liabilities = (r.liabilities.credit ?? [])
        .filter((c) => c.account_id)
        .map((c) => ({
          accountId: c.account_id!,
          lastStatementBalance: c.last_statement_balance,
          lastStatementIssueDate: c.last_statement_issue_date,
          minimumPaymentAmount: c.minimum_payment_amount,
          nextPaymentDueDate: c.next_payment_due_date,
          purchaseApr: (c.aprs.find((a) => a.apr_type === 'purchase_apr') ?? c.aprs[0])?.apr_percentage ?? null,
        }));
    } catch (e) {
      if (!(e instanceof PlaidApiError && NO_LIABILITIES.has(e.code))) throw e;
    }
  }

  return {
    accounts: accounts.map((a) => ({
      id: a.account_id,
      name: a.name,
      officialName: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      current: a.balances.current,
      available: a.balances.available,
      limit: a.balances.limit,
    })),
    added: added.map(trimTxn),
    modified: modified.map(trimTxn),
    removed,
    nextCursor: next ?? '',
    liabilities,
  };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handle(req: Request, env: Env, fetchFn: FetchFn = fetch): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, env: env.PLAID_ENV ?? 'production' });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  if (!env.APP_SECRET || !env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    return json({ error: 'SERVER_NOT_CONFIGURED', message: 'Set PLAID_CLIENT_ID, PLAID_SECRET and APP_SECRET.' }, 500);
  }
  const auth = req.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${env.APP_SECRET}`)) return json({ error: 'UNAUTHORIZED', message: 'Wrong app secret.' }, 401);

  let body: Record<string, string | null | undefined> = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body is fine for some routes
  }

  try {
    switch (url.pathname) {
      case '/link-token': {
        const update = !!body.accessToken;
        const r = await plaid<{ link_token: string }>(env, fetchFn, '/link/token/create', {
          user: { client_user_id: 'owner' },
          client_name: 'BudgetApp',
          language: 'en',
          country_codes: ['US'],
          ...(update
            ? { access_token: body.accessToken } // update mode: re-authenticate an existing Item
            : { products: ['transactions'], optional_products: ['liabilities'], transactions: { days_requested: 730 } }),
          ...(env.ANDROID_PACKAGE_NAME ? { android_package_name: env.ANDROID_PACKAGE_NAME } : {}),
        });
        return json({ linkToken: r.link_token });
      }
      case '/exchange': {
        if (!body.publicToken) return json({ error: 'BAD_REQUEST', message: 'publicToken required' }, 400);
        const r = await plaid<{ access_token: string; item_id: string }>(env, fetchFn, '/item/public_token/exchange', {
          public_token: body.publicToken,
        });
        return json({ accessToken: r.access_token, itemId: r.item_id });
      }
      case '/sync': {
        if (!body.accessToken) return json({ error: 'BAD_REQUEST', message: 'accessToken required' }, 400);
        return json(await syncItem(env, fetchFn, body.accessToken, body.cursor || null));
      }
      case '/remove': {
        if (!body.accessToken) return json({ error: 'BAD_REQUEST', message: 'accessToken required' }, 400);
        await plaid(env, fetchFn, '/item/remove', { access_token: body.accessToken });
        return json({ ok: true });
      }
      default:
        return json({ error: 'NOT_FOUND' }, 404);
    }
  } catch (e) {
    if (e instanceof PlaidApiError) return json({ error: e.code, type: e.type, message: e.message }, e.status >= 500 ? 502 : 400);
    return json({ error: 'INTERNAL', message: e instanceof Error ? e.message : String(e) }, 500);
  }
}
