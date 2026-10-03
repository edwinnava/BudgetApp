# BudgetApp

A personal, on-device take on Rocket Money for iOS and Android, built with Expo (React Native).

- **Spending**: transactions from linked bank and card accounts, sorted into categories automatically. Recategorize once and every transaction from that merchant follows.
- **Recurring bills**: add bills yourself, or let the app scan your history for subscriptions and bills. Shows upcoming due dates, monthly/yearly totals, and payment history.
- **Budgets**: a monthly budget per category, with progress bars, what's left, and a per-day allowance.
- **Credit card payoff** (not in Rocket Money):
  - Current balance, statement balance, due date, APR, minimum payment, credit limit and utilization for each card.
  - A payoff plan for the monthly amount you can afford, using **Avalanche** (highest APR first) or **Snowball** (smallest balance first). It shows your debt-free date, total interest, and how much you save compared with paying only the minimums.
  - Payment tracking: how much you've sent to each card this cycle against the plan's suggested amount, whether the statement is paid in full (no interest), and monthly totals sent to cards.
  - Payments are picked up from synced card transactions automatically. You can also log them by hand, or link a payment from your checking account to a card.

- **Due date reminders**: notifications before card payments and bills are due, with how much is left on the statement and the plan's suggested payment.

Everything is stored **only on your phone**, in a local SQLite database. There's no server and no account.

## Connecting banks

### Plaid (recommended)

Plaid connects to almost every US bank and card issuer. For credit cards it also provides the **statement balance, minimum payment, due date and APR**, so the payoff plan and reminders fill themselves in. Plaid's free **Trial plan** allows up to 10 linked logins.

Plaid's secret key can't be built into the app. A tiny server in [`server/`](server/) holds it: a free Cloudflare Worker that only passes requests through and stores nothing. Each bank's access token stays in your phone's keystore, and your financial data is stored only on the phone.

**One-time setup (about 10 minutes):**

1. **Plaid account.** Sign up at [dashboard.plaid.com](https://dashboard.plaid.com) and choose the free Trial plan. OAuth banks (Chase, Capital One, Citi) usually start working 6–24 hours after approval.
2. **Keys.** In the Plaid Dashboard, copy your `client_id` and your **Production** secret (Developers → Keys).
3. **Android package name.** In the Plaid Dashboard (Developers → API → Allowed Android package names), add `com.edwinnava.budgetapp`. OAuth logins like Chase fail without it.
4. **Deploy the worker** (needs a free Cloudflare account):
   ```bash
   cd server
   npm install
   npx wrangler login
   npx wrangler secret put PLAID_CLIENT_ID     # paste client_id
   npx wrangler secret put PLAID_SECRET        # paste the Production secret
   npx wrangler secret put APP_SECRET          # paste a long random string (see below)
   npx wrangler deploy                         # prints https://budgetapp-plaid.<you>.workers.dev
   ```
   For `APP_SECRET`, generate any long random string, for example `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Only your app knows it, which stops anyone else from using your worker or your Plaid account.
5. **Connect the app.** Open **Settings → Bank connection (Plaid)**, enter the worker URL and the app secret, then tap **Link a bank or card** for each bank.

After linking, the first sync brings in balances right away. Plaid can take a minute or two to pull up to 2 years of transaction history; the app fetches again automatically after 30 seconds, and pull-to-refresh on Overview syncs again.

When a bank needs you to log in again (password change, expired consent), Settings shows **Reconnect** next to that bank.

To test without real accounts, set `PLAID_ENV = "sandbox"` in `server/wrangler.toml` and use your **Sandbox** secret. In Plaid Link, log in with `user_good` / `pass_good`.

### SimpleFIN (alternative)

For a bank Plaid can't reach, [SimpleFIN Bridge](https://beta-bridge.simplefin.org) ($15/year) works with no server: create a setup token on their site and paste it under **Settings → Bank connection (SimpleFIN)**. It provides current balances and transactions but not statement details, so you enter those on each card's screen.

### Other options

You can **import CSV** exports from your bank's website (Settings → Import CSV) or add accounts and transactions manually. To look around first, use **Settings → Load demo data**.

If an account is detected as the wrong type, change it under Settings → Accounts. Credit cards must be set to **Card** to appear in the Cards tab.

## Running it

Requires Node 20+.

```bash
npm install
npx expo start
```

Install **Expo Go** on your phone and scan the QR code. Everything works in Expo Go except linking banks with Plaid, which needs the installed build below.

### Installing it as a real app

Use [EAS Build](https://docs.expo.dev/build/introduction/) (cloud builds, no Xcode or Android Studio needed):

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # gives you an .apk to install (includes Plaid Link)
npx eas-cli@latest build -p ios --profile preview       # needs an Apple Developer account
```

On iOS, apps installed outside the App Store need an Apple Developer membership ($99/yr) for an ad-hoc build. Without one, Xcode with a free Apple ID can install the app, but it expires after 7 days.

## Development

```bash
npm test           # unit + integration tests (vitest), including the worker
npm run lint
npm run typecheck  # tsc
```

Layout:

| Path | What |
| --- | --- |
| `src/app/` | Screens (Expo Router). `(tabs)/` holds the Overview, Spending, Recurring, Budget and Cards tabs |
| `src/lib/` | Pure logic with tests: recurring detection, payoff simulation, categorization, CSV parsing, SimpleFIN client, dates |
| `src/db/` | SQLite schema/migrations, queries, the `useQuery` hook, demo data |
| `src/sync/` | Plaid and SimpleFIN sync, transaction ingest (auto-categorize, card payment detection) |
| `src/notifications/` | Due date reminder scheduling |
| `server/` | Cloudflare Worker that holds the Plaid secret and proxies Plaid calls |
| `src/components/` | Shared UI and theme (light/dark) |

## Ideas for later

- iOS build with Plaid OAuth redirect (needs an Apple Developer account)
- Encrypted backup/export of the database
- Net worth history charts
