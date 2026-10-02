/**
 * Merchant normalization and rule/keyword based categorization.
 */

const NOISE_WORDS = new Set([
  'POS', 'DEBIT', 'CREDIT', 'PURCHASE', 'ACH', 'RECURRING', 'CARD', 'CHECKCARD', 'VISA', 'MC',
  'PAYMENT', 'PMT', 'ONLINE', 'WEB', 'ID', 'PPD', 'WEB', 'TST', 'SQ', 'SQU', 'PAYPAL', 'DES',
  'INDN', 'CO', 'ENTRY', 'DBT', 'PREAUTH', 'AUTH', 'XX', 'XXXX', 'THE', 'INC', 'LLC',
]);

/** Prefixes like "SQ *" or "TST*" come before the real merchant name. */
const PREFIX_RE = /^(SQ|TST|SP|PAYPAL|PP|DD|IN|GOOGLE|APPLE\.COM\/BILL)\s*\*\s*/i;

/**
 * Reduces a raw bank description to a stable key, e.g.
 * "NETFLIX.COM 866-579-7172 CA" -> "NETFLIX COM", "SQ *BLUE BOTTLE #123" -> "BLUE BOTTLE".
 */
export function normalizeMerchant(raw: string): string {
  let s = raw.toUpperCase().trim().replace(PREFIX_RE, '');
  s = s
    .replace(/\*/g, ' ')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b\d[\d-]{2,}\b/g, ' ') // phone numbers, store numbers, refs
    .replace(/\b[A-Z]*\d+[A-Z\d]*\b/g, ' ') // tokens containing digits
    .replace(/[^A-Z&' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter((w) => (w.length > 1 || w === '&') && !NOISE_WORDS.has(w));
  // Drop a trailing US state code ("... SEATTLE WA").
  if (words.length > 2 && /^[A-Z]{2}$/.test(words[words.length - 1])) words.pop();
  const kept: string[] = [];
  for (const w of words) {
    if (kept.filter((k) => k !== '&').length === 3) break;
    kept.push(w);
  }
  while (kept[kept.length - 1] === '&') kept.pop();
  return kept.join(' ') || raw.toUpperCase().trim().slice(0, 24);
}

export function displayMerchant(key: string): string {
  return key
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCom\b/, '.com')
    .replace(' .com', '.com');
}

export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface DefaultCategory {
  name: string;
  icon: string;
  color: string;
  kind: CategoryKind;
  keywords: string[];
}

export const CARD_PAYMENT_CATEGORY = 'Credit Card Payment';
export const TRANSFER_CATEGORY = 'Transfer';
export const INCOME_CATEGORY = 'Income';

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: 'Groceries', icon: 'cart', color: '#2e9e5b', kind: 'expense', keywords: ['GROCERY', 'SAFEWAY', 'KROGER', 'WHOLE FOODS', 'TRADER JOE', 'ALDI', 'PUBLIX', 'HEB', 'WEGMANS', 'COSTCO', 'SPROUTS', 'FOOD LION', 'MARKET'] },
  { name: 'Dining', icon: 'restaurant', color: '#e8833a', kind: 'expense', keywords: ['RESTAURANT', 'CAFE', 'COFFEE', 'STARBUCKS', 'DUNKIN', 'MCDONALD', 'CHIPOTLE', 'DOORDASH', 'UBER EATS', 'UBEREATS', 'GRUBHUB', 'PIZZA', 'TACO', 'BURGER', 'GRILL', 'SUBWAY', 'WENDY', 'CHICK FIL', 'KITCHEN'] },
  { name: 'Transportation', icon: 'car', color: '#3b82f6', kind: 'expense', keywords: ['UBER', 'LYFT', 'SHELL', 'CHEVRON', 'EXXON', 'MOBIL', 'GAS', 'FUEL', 'PARKING', 'TOLL', 'TRANSIT', 'METRO', 'BP'] },
  { name: 'Shopping', icon: 'bag', color: '#a855f7', kind: 'expense', keywords: ['AMAZON', 'AMZN', 'TARGET', 'WALMART', 'BEST BUY', 'EBAY', 'ETSY', 'IKEA', 'HOME DEPOT', 'LOWE', 'APPLE STORE', 'MACY', 'NORDSTROM', 'KOHL'] },
  { name: 'Subscriptions', icon: 'repeat', color: '#ec4899', kind: 'expense', keywords: ['NETFLIX', 'SPOTIFY', 'HULU', 'DISNEY', 'HBO', 'YOUTUBE', 'APPLE COM BILL', 'ICLOUD', 'PARAMOUNT', 'PEACOCK', 'AUDIBLE', 'PATREON', 'ADOBE', 'MICROSOFT', 'OPENAI', 'DROPBOX'] },
  { name: 'Bills & Utilities', icon: 'flash', color: '#eab308', kind: 'expense', keywords: ['ELECTRIC', 'ENERGY', 'POWER', 'WATER', 'UTILITY', 'COMCAST', 'XFINITY', 'VERIZON', 'AT&T', 'T MOBILE', 'TMOBILE', 'SPECTRUM', 'INTERNET', 'PG&E', 'DUKE', 'CON ED'] },
  { name: 'Housing', icon: 'home', color: '#64748b', kind: 'expense', keywords: ['RENT', 'MORTGAGE', 'HOA', 'APARTMENT', 'PROPERTY'] },
  { name: 'Insurance', icon: 'shield-checkmark', color: '#0ea5e9', kind: 'expense', keywords: ['INSURANCE', 'GEICO', 'PROGRESSIVE', 'STATE FARM', 'ALLSTATE', 'LEMONADE'] },
  { name: 'Health', icon: 'medkit', color: '#ef4444', kind: 'expense', keywords: ['PHARMACY', 'CVS', 'WALGREENS', 'DOCTOR', 'DENTAL', 'MEDICAL', 'HOSPITAL', 'CLINIC', 'GYM', 'FITNESS', 'PLANET FIT'] },
  { name: 'Entertainment', icon: 'film', color: '#8b5cf6', kind: 'expense', keywords: ['CINEMA', 'THEATER', 'AMC', 'STEAM', 'PLAYSTATION', 'XBOX', 'NINTENDO', 'TICKETMASTER', 'CONCERT'] },
  { name: 'Travel', icon: 'airplane', color: '#14b8a6', kind: 'expense', keywords: ['AIRLINE', 'AIRBNB', 'HOTEL', 'MARRIOTT', 'HILTON', 'DELTA', 'UNITED', 'SOUTHWEST', 'AMERICAN AIR', 'EXPEDIA'] },
  { name: 'Personal Care', icon: 'happy', color: '#f472b6', kind: 'expense', keywords: ['SALON', 'BARBER', 'SPA', 'SEPHORA', 'ULTA'] },
  { name: 'Fees & Interest', icon: 'alert-circle', color: '#dc2626', kind: 'expense', keywords: ['FEE', 'INTEREST CHARGE', 'FINANCE CHARGE', 'LATE CHARGE', 'OVERDRAFT'] },
  { name: 'Other', icon: 'ellipsis-horizontal', color: '#94a3b8', kind: 'expense', keywords: [] },
  { name: INCOME_CATEGORY, icon: 'cash', color: '#16a34a', kind: 'income', keywords: ['PAYROLL', 'DIRECT DEP', 'SALARY', 'DEPOSIT', 'INTEREST PAID', 'REFUND'] },
  { name: TRANSFER_CATEGORY, icon: 'swap-horizontal', color: '#6b7280', kind: 'transfer', keywords: ['TRANSFER', 'XFER', 'ZELLE', 'VENMO', 'CASH APP'] },
  { name: CARD_PAYMENT_CATEGORY, icon: 'card', color: '#0f766e', kind: 'transfer', keywords: [] },
];

const CARD_PAYMENT_RE =
  /\b(AUTOPAY|AUTO PAY|AUTOMATIC PAYMENT|PAYMENT\s*(-|–)?\s*THANK YOU|THANK YOU|ONLINE PAYMENT|MOBILE PAYMENT|PAYMENT RECEIVED|E-?PAYMENT|PYMT|INTERNET PAYMENT)\b/i;

const CARD_ISSUER_RE =
  /\b(CHASE|AMEX|AMERICAN EXPRESS|CITI|CAPITAL ONE|CAPITALONE|DISCOVER|BARCLAY|SYNCHRONY|WELLS FARGO|BANK OF AMERICA|BK OF AMER|US BANK|APPLE CARD|GS BANK|GOLDMAN)\b/i;

/** On the credit card account itself: a credit that is a payment (not a refund). */
export function isPaymentToCard(description: string): boolean {
  return CARD_PAYMENT_RE.test(description) || /\bPAYMENT\b/i.test(description);
}

/** On a checking account: an outflow that looks like paying a credit card bill. */
export function looksLikeCardBillPayment(description: string): boolean {
  const d = description.toUpperCase();
  if (/CRD(T)?\s*(PMT|PAYMENT|AUTOPAY|EPAY)|CREDIT CARD|CARD PAYMENT|CRCARDPMT|CREDIT CRD/.test(d)) return true;
  return CARD_ISSUER_RE.test(d) && /(PAYMENT|AUTOPAY|EPAY|PMT|E-PAY)/.test(d);
}

const wordsOf = (s: string) => ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;

/** Whole-word keyword match so "GAS" does not match "LAS VEGAS". */
export function matchesKeyword(description: string, keyword: string): boolean {
  return wordsOf(description).includes(wordsOf(keyword));
}

export interface Rule {
  pattern: string; // normalized merchant key or substring (upper case)
  categoryName: string;
}

export interface CategorizeInput {
  description: string;
  amount: number;
  accountType: string;
}

/**
 * Picks a category name for a new transaction. User rules win, then special cases
 * (card payments, transfers), then keyword matches.
 */
export function guessCategory(input: CategorizeInput, rules: Rule[] = []): string | null {
  const desc = input.description.toUpperCase();
  const key = normalizeMerchant(input.description);
  for (const r of rules) {
    if (key === r.pattern || desc.includes(r.pattern)) return r.categoryName;
  }
  if (input.accountType === 'credit' && input.amount > 0 && isPaymentToCard(desc)) return CARD_PAYMENT_CATEGORY;
  if (input.accountType !== 'credit' && input.amount < 0 && looksLikeCardBillPayment(desc)) return CARD_PAYMENT_CATEGORY;
  for (const c of DEFAULT_CATEGORIES) {
    if (c.kind === 'income' && input.amount < 0) continue;
    if (c.keywords.some((k) => matchesKeyword(desc, k))) return c.name;
  }
  if (input.amount > 0 && input.accountType !== 'credit') return INCOME_CATEGORY;
  return null;
}
