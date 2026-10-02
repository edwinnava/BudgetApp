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

Everything is stored **only on your phone**, in a local SQLite database. There's no server and no account.

## Connecting banks

Bank data comes from [SimpleFIN Bridge](https://beta-bridge.simplefin.org), about $15/year. The app talks to it directly from your phone:

1. Create a SimpleFIN Bridge account and connect your banks and cards there.
2. Create a **setup token**.
3. In the app, go to **Settings (gear) → Bank connection**, paste the token, and tap **Connect**.

The access key it creates is kept in the iOS Keychain / Android Keystore. SimpleFIN refreshes about once a day; pull down on the Overview screen to sync.

Notes:
- SimpleFIN gives current balances, not statement balances. Enter a card's statement balance, statement close day, due day, APR and minimum on the card screen (all are on your statement). For synced cards the app can also estimate the statement balance from transactions.
- If an account is detected as the wrong type, change it under Settings → Accounts. Credit cards must be set to **Card** to appear in the Cards tab.

Without SimpleFIN, you can **import CSV** exports from your bank's website (Settings → Import CSV) or add accounts and transactions manually. To look around first, use **Settings → Load demo data**.

## Running it

Requires Node 20+.

```bash
npm install
npx expo start
```

Install **Expo Go** on your phone and scan the QR code. Every native module the app uses ships in Expo Go, so there's nothing to compile.

### Installing it as a real app

Use [EAS Build](https://docs.expo.dev/build/introduction/) (cloud builds, no Xcode or Android Studio needed):

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview   # gives you an .apk to install
npx eas-cli@latest build -p ios --profile preview       # needs an Apple Developer account
```

On iOS, apps installed outside the App Store need an Apple Developer membership ($99/yr) for an ad-hoc build. Without one, Xcode with a free Apple ID can install the app, but it expires after 7 days.

## Development

```bash
npm test           # unit tests for the finance logic (vitest)
npm run typecheck  # tsc
```

Layout:

| Path | What |
| --- | --- |
| `src/app/` | Screens (Expo Router). `(tabs)/` holds the Overview, Spending, Recurring, Budget and Cards tabs |
| `src/lib/` | Pure logic with tests: recurring detection, payoff simulation, categorization, CSV parsing, SimpleFIN client, dates |
| `src/db/` | SQLite schema/migrations, queries, the `useQuery` hook, demo data |
| `src/sync/` | SimpleFIN sync and transaction ingest (auto-categorize, card payment detection) |
| `src/components/` | Shared UI and theme (light/dark) |

## Ideas for later

- Due-date reminders (expo-notifications)
- Plaid, through a small self-hosted server, for institutions SimpleFIN doesn't cover
- Encrypted backup/export of the database
- Net worth history charts
