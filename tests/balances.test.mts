import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceSource, fetchBalances, parseChainIds, parseTokenList } from '../src/balances.ts';
import { setLimiterTiming } from '../src/limiter.ts';
import type { Endpoint } from '../src/store.ts';

setLimiterTiming({ gapMs: 1, basePauseMs: 10, reset: true });

const ep = (over: Partial<Endpoint>): Endpoint => ({ id: 'e', name: 'n', url: 'https://src.invalid/h?id={address}', family: 'erc20', enabled: true, ...over }) as Endpoint;
const fake = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, clone() { return this; } });

test('token list: zero amounts dropped, usd = amount × price, symbol fallback order', () => {
  const rows = parseTokenList(
    [
      { id: '0xa', chain: 'op', optimized_symbol: 'USDC', symbol: 'USDC.e', name: 'USD Coin', amount: 12.5, price: 1, is_verified: true },
      { id: '0xb', chain: 'op', symbol: 'DUST', amount: 0, price: 3 },
      { id: 'op', display_symbol: 'ETH', amount: '0.5', price: 2000, logo_url: 'https://logo.invalid/e.png' },
      { id: '0xc', symbol: 'NOPRICE', amount: 7, is_verified: false },
    ],
    'op',
  );
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.symbol), ['USDC', 'ETH', 'NOPRICE']);
  assert.equal(rows[1]!.usd, 1000);
  assert.equal(rows[1]!.chain, 'op', 'chain taken from the request when the row has none');
  assert.equal(rows[2]!.usd, null);
  assert.equal(rows[2]!.verified, false);
});

test('chain ids: unique, skips junk', () => {
  assert.deepEqual(parseChainIds([{ id: 'eth' }, { id: 'op' }, { id: 'eth' }, {}, 3]), ['eth', 'op']);
  assert.deepEqual(parseChainIds({ data: [{ id: 'base' }] }), ['base']);
});

test('source: first enabled ERC-20 endpoint origin; Solana wallets and Solana sources never used', () => {
  const list = [ep({ id: 's', family: 'sol', url: 'https://sol.invalid/x' }), ep({ id: 'off', enabled: false, url: 'https://off.invalid/x' }), ep({ id: 'a' }), ep({ id: 'b', url: 'https://b.invalid/x' })];
  assert.equal(balanceSource(list, { family: 'erc20' })?.origin, 'https://src.invalid');
  assert.equal(balanceSource(list, { family: 'sol' }), null);
  assert.equal(balanceSource([ep({ family: 'sol' })], { family: 'erc20' }), null);
});

test('429 mid-way: stops, returns what it has, flags limited', async () => {
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 10 });
  const seen: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (u: string) => {
    seen.push(u);
    if (u.includes('used_chain_list')) return fake(200, [{ id: 'eth' }, { id: 'op' }, { id: 'base' }]);
    if (u.includes('chain_id=eth')) return fake(200, [{ id: 'eth', symbol: 'ETH', amount: 1, price: 2000 }]);
    return fake(429, {});
  };
  const b = await fetchBalances(ep({}), 'https://src.invalid', '0xabc');
  assert.equal(b.limited, true);
  assert.equal(b.rows.length, 1);
  assert.equal(seen.filter((u) => u.includes('token_list')).length, 2, 'no request after the 429');
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 10 });
});
