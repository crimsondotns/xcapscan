import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceSource, fetchBalances, matchBalance, parseChainIds, parseTokenList } from '../src/balances.ts';
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
  assert.equal(balanceSource([ep({ url: 'b/h' })], { family: 'erc20' })?.origin, 'b', 'wrapper alias');
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

test('filter: symbol/name contains, token address prefix, chain', () => {
  const [usdc, eth] = parseTokenList(
    [
      { id: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', chain: 'eth', symbol: 'USDC', name: 'USD Coin', amount: 1, price: 1 },
      { id: 'op', chain: 'op', symbol: 'ETH', name: 'Ether', amount: 1, price: 1 },
    ],
    'eth',
  ) as [never, never];
  assert.equal(matchBalance(usdc, 'usd'), true);
  assert.equal(matchBalance(usdc, 'coin'), true);
  assert.equal(matchBalance(usdc, '0xa0b8'), true, 'address prefix, any case');
  assert.equal(matchBalance(usdc, '6eb48'), false, 'address must match from the start');
  assert.equal(matchBalance(eth, ''), true);
  assert.equal(matchBalance(eth, '', 'eth'), false);
  assert.equal(matchBalance(eth, 'eth', 'op'), true);
});
