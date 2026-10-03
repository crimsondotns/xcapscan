import test from 'node:test';
import assert from 'node:assert/strict';
import { addDec, balanceSource, fetchBalances, fromRaw, matchBalance, parseChainIds, parseJsonExact, parsePositions, parseTokenList } from '../src/balances.ts';
import { setLimiterTiming } from '../src/limiter.ts';
import type { Endpoint } from '../src/store.ts';

setLimiterTiming({ gapMs: 1, basePauseMs: 10, reset: true, hostRefillMs: 1 });

const ep = (over: Partial<Endpoint>): Endpoint => ({ id: 'e', name: 'n', url: 'https://src.invalid/h?id={address}', family: 'erc20', enabled: true, ...over }) as Endpoint;
const fake = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });

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

test('source: first enabled endpoint of the wallet family', () => {
  const list = [ep({ id: 's', family: 'sol', url: 'https://sol.invalid/x' }), ep({ id: 'off', enabled: false, url: 'https://off.invalid/x' }), ep({ id: 'a' }), ep({ id: 'b', url: 'https://b.invalid/x' })];
  assert.equal(balanceSource(list, { family: 'erc20' })?.origin, 'https://src.invalid');
  assert.equal(balanceSource(list, { family: 'sol' })?.origin, 'https://sol.invalid');
  assert.equal(balanceSource([ep({ family: 'sol' })], { family: 'erc20' }), null);
});

test('429 mid-way: stops, returns what it has, flags limited', async () => {
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 10 });
  const seen: string[] = [];
  let hit429 = false;
  let afterHit = 0;
  (globalThis as { fetch: unknown }).fetch = async (u: string) => {
    if (hit429) afterHit++;
    seen.push(u);
    if (u.includes('used_chain_list')) return fake(200, [{ id: 'eth' }, { id: 'op' }, { id: 'base' }, { id: 'arb' }]);
    if (u.includes('chain_id=eth')) return fake(200, [{ id: 'eth', symbol: 'ETH', amount: 1, price: 2000 }]);
    hit429 = true;
    return fake(429, {});
  };
  const b = await fetchBalances(ep({}), 'https://src.invalid', '0xabc');
  assert.equal(b.limited, true);
  assert.equal(b.rows.length, 1);
  // คำขอที่อีกงานส่งเข้าคิวไว้ก่อนเห็น 429 อาจออกหลังคิวพักครบ ได้มากสุด 1 (= PARALLEL − 1) ไม่มีคำขอใหม่เกินนั้น
  assert.ok(afterHit <= 1, 'at most the one request already queued');
  assert.ok(seen.filter((u) => u.includes('token_list')).length < 4, 'remaining chains skipped');
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

test('solana: pnl-positions parsed (plain or wrapped by address), zero balance dropped, price = value ÷ amount', () => {
  const pos = [
    { assetId: 'J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr', balance: 4986.85169601, balanceValue: 2231.7988273156934 },
    { assetId: 'Zero111111111111111111111111111111111111111', balance: 0, balanceValue: 0 },
  ];
  for (const body of [{ tokenPositions: pos }, { addr: { tokenPositions: pos } }]) {
    const rows = parsePositions(body);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.chain, 'sol');
    assert.equal(rows[0]!.usd, 2231.7988273156934);
    assert.ok(Math.abs(rows[0]!.price! - 0.44753) < 1e-4);
  }
  assert.equal(balanceSource([ep({ family: 'sol', url: 'https://sol.invalid/x' })], { family: 'sol' })?.origin, 'https://sol.invalid');
});

test('price cache: an old trade does not overwrite the current SOL price; balance prices count as now', async () => {
  const { fetchPage } = await import('../src/feed.ts');
  const { priceOf } = await import('../src/prices.ts');
  const { rememberBalancePrices } = await import('../src/balances.ts');
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 10 });
  const trade = { userTrades: [{ type: 'buy', assetId: 'J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr', usdVolume: 540.475, nativeVolume: 6.5, amount: 1000, price: 0.54, blockTime: '2026-01-17T09:30:45.000Z', txHash: 'h1' }] };
  (globalThis as { fetch: unknown }).fetch = async () => fake(200, trade);
  // trade loaded first, then the balance → the balance (now) wins
  await fetchPage('https://src.invalid/v1/pnl-activity?address={address}', 'w', 'GZ3tQp5qH91afiepNWecsExxdeptwsM9hu1bMVD1i5Ff', null, 20, { family: 'sol' });
  assert.equal(Math.round(priceOf('sol', null, 'SOL')!), 83);
  rememberBalancePrices(parsePositions({ tokenPositions: [] }).concat([{ chain: 'sol', tokenId: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'SOL', logo: null, amount: 1.3113, price: 121.4, usd: 159.2, verified: true }]));
  assert.equal(priceOf('sol', null, 'SOL'), 121.4);
  // the old trade loaded again later must not push the price back to 83
  await fetchPage('https://src.invalid/v1/pnl-activity?address={address}', 'w', 'GZ3tQp5qH91afiepNWecsExxdeptwsM9hu1bMVD1i5Ff', null, 20, { family: 'sol' });
  assert.equal(priceOf('sol', null, 'SOL'), 121.4);
});

test('exact decimals: raw ÷ 10^decimals, string sums, source text kept, grouped display', async () => {
  const { formatDecimalText } = await import('../src/format.ts');
  assert.equal(fromRaw('6121694927414180623165749', 18), '6121694.927414180623165749');
  assert.equal(fromRaw('5', 6), '0.000005');
  assert.equal(fromRaw('1000000', 6), '1');
  assert.equal(addDec('0.1', '0.2'), '0.3');
  assert.equal(addDec('6121694.927414180623165749', '0.000000000000000001'), '6121694.92741418062316575');
  const j = parseJsonExact('{"data":[{"id":"0xa","amount":6121694.927414180623165749,"raw_amount":6121694927414180623165749,"decimals":18,"price":1}]}') as { data: Array<Record<string, unknown>> };
  const [row] = parseTokenList(j, 'eth');
  if (typeof (j.data[0]!.raw_amount) === 'string') assert.equal(row!.exact, '6121694.927414180623165749');
  assert.equal(formatDecimalText('6121694.927414180623165749'), '6,121,694.927414180623165749');
});

test('balances: token_list per chain runs 2 at a time (not one by one), partial results reported', async () => {
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 10 });
  let live = 0;
  let peak = 0;
  (globalThis as { fetch: unknown }).fetch = async (u: string) => {
    if (u.includes('used_chain_list')) return fake(200, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]);
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 30));
    live--;
    const c = /chain_id=(\w+)/.exec(u)![1];
    return fake(200, [{ id: c, symbol: c.toUpperCase(), amount: 1, price: 1 }]);
  };
  const parts: number[] = [];
  const b = await fetchBalances(ep({ id: 'par' }), 'https://par.invalid', '0xpar', (p) => parts.push(p.rows.length));
  assert.equal(b.rows.length, 4);
  assert.equal(peak, 2);
  assert.deepEqual(parts, [1, 2, 3, 4]);
});
