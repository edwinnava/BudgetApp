import { describe, expect, it } from 'vitest';
import { decodeSetupToken, normalizeAccountSet, splitAccessUrl } from '../simplefin';

describe('simplefin', () => {
  it('decodes setup tokens', () => {
    const url = 'https://bridge.simplefin.org/simplefin/claim/abc';
    expect(decodeSetupToken(btoa(url))).toBe(url);
    expect(() => decodeSetupToken(btoa('nope'))).toThrow();
  });
  it('splits access URLs into basic auth', () => {
    const r = splitAccessUrl('https://user:p%40ss@bridge.simplefin.org/simplefin/');
    expect(r.baseUrl).toBe('https://bridge.simplefin.org/simplefin');
    expect(r.authorization).toBe(`Basic ${btoa('user:p@ss')}`);
  });
  it('normalizes accounts', () => {
    const [a] = normalizeAccountSet({
      errors: [],
      accounts: [
        {
          id: 'ACT-1',
          name: 'Sapphire Preferred',
          currency: 'USD',
          balance: '-1234.56',
          'balance-date': 1790000000,
          org: { name: 'Chase' },
          transactions: [{ id: 't1', posted: 1790000000, amount: '-12.00', description: 'COFFEE', pending: false }],
        },
      ],
    });
    expect(a).toMatchObject({ externalId: 'ACT-1', institution: 'Chase', balance: -1234.56, guessedType: 'credit' });
    expect(a.transactions[0]).toMatchObject({ externalId: 't1', amount: -12, description: 'COFFEE' });
  });
});
