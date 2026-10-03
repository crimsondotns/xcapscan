import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceOfCall, decodeAggregate3, encodeAggregate3, MULTICALL3, nativeCall, parseRpcList } from '../src/rpc.ts';
import { refreshViaRpc, type BalanceRow } from '../src/balances.ts';
import { setLimiterTiming } from '../src/limiter.ts';

setLimiterTiming({ gapMs: 1, basePauseMs: 10, reset: true, hostRefillMs: 1 });

const W = '0x00000000000000000000000000000000000000aa';
const T = '0x00000000000000000000000000000000000000bb';
const word = (n: number | bigint) => BigInt(n).toString(16).padStart(64, '0');

/** ผลของ aggregate3 แบบ ABI จริง: Result[] = (bool success, bytes returnData)[] */
function encodeResults(res: (bigint | null)[]): string {
  const heads: string[] = [];
  const tails: string[] = [];
  let off = res.length * 32;
  for (const r of res) {
    const t = r === null ? word(0) + word(64) + word(0) : word(1) + word(64) + word(32) + word(r);
    heads.push(word(off));
    tails.push(t);
    off += t.length / 2;
  }
  return `0x${word(32)}${word(res.length)}${heads.join('')}${tails.join('')}`;
}

test('rpc list: https only, no key placeholders, tracking none first, numeric chain ids', () => {
  const m = parseRpcList([
    { chainId: 1, rpc: [{ url: 'https://a.invalid', tracking: 'yes' }, { url: 'https://b.invalid', tracking: 'none' }, 'wss://ws.invalid', 'https://k.invalid/${INFURA_API_KEY}', 'https://x.invalid/?apikey=1'] },
    { chainId: '56', rpc: ['https://c.invalid'] },
    { chainId: 'x', rpc: ['https://d.invalid'] },
    { chainId: 10, rpc: [] },
  ]);
  assert.deepEqual(m.get(1), ['https://b.invalid', 'https://a.invalid']);
  assert.deepEqual(m.get(56), ['https://c.invalid']);
  assert.equal(m.size, 2);
});

test('aggregate3 calldata: selector, array layout, padded callData', () => {
  const hex = encodeAggregate3([balanceOfCall(T, W), nativeCall(W)]);
  assert.ok(hex.startsWith('0x82ad56cb'));
  const h = hex.slice(10);
  const w = (i: number) => BigInt(`0x${h.slice(i * 64, i * 64 + 64)}`);
  assert.equal(w(0), 32n);
  assert.equal(w(1), 2n);
  // ทูเพิลแรกเริ่มหลังหัว 2 ช่อง: target, allowFailure, offset 96, len 36, data 2 ช่อง
  assert.equal(w(4), BigInt(T));
  assert.equal(w(5), 1n);
  assert.equal(w(6), 96n);
  assert.equal(w(7), 36n);
  assert.ok(h.slice(8 * 64).startsWith('70a08231'));
  assert.equal(w(3) - w(2), 192n, 'each tuple = 6 words');
  assert.equal(w(4 + 6), BigInt(MULTICALL3));
});

test('aggregate3 results decode; failed calls are null', () => {
  assert.deepEqual(decodeAggregate3(encodeResults([123n, null, 10n ** 30n])), ['123', null, (10n ** 30n).toString()]);
});

const row = (over: Partial<BalanceRow>): BalanceRow => ({ chain: 'eth', tokenId: T, symbol: 'TKN', name: 'TKN', logo: null, amount: 1, price: 2, usd: 2, verified: true, decimals: 6, ...over });

test('refresh via rpc: new amounts, keeps price, drops zeros, unknown chains go back to the source', async () => {
  const calls: string[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).startsWith('https://dead.invalid')) return new Response('x', { status: 429 });
    const body = JSON.parse(String(init?.body)) as { params: [{ data: string }] };
    const n = Number(BigInt(`0x${body.params[0].data.slice(10 + 64, 10 + 128)}`));
    const res = n === 3 ? [2_500_000n, 5n * 10n ** 17n, 0n] : [];
    return new Response(JSON.stringify({ result: encodeResults(res) }), { status: 200 });
  }) as typeof fetch;
  try {
    const chains = new Map([['eth', { id: 'eth', name: 'Ethereum', logo: null, explorer: null, symbol: 'ETH', evmId: 1 }], ['op', { id: 'op', name: 'OP', logo: null, explorer: null, symbol: 'ETH', evmId: 10 }]]);
    const rpcs = new Map([[1, ['https://dead.invalid', 'https://rpc.invalid']]]);
    const rows = [row({}), row({ tokenId: 'eth', symbol: 'ETH', decimals: 18, price: 1000 }), row({ tokenId: '0x00000000000000000000000000000000000000cc', symbol: 'GONE' }), row({ chain: 'op' }), row({ chain: 'nochain' })];
    const got = await refreshViaRpc(rows, W, chains, rpcs);
    assert.deepEqual(got.missing.sort(), ['nochain', 'op']);
    assert.deepEqual(got.rows.map((r) => [r.symbol, r.exact, r.usd]), [['ETH', '0.5', 500], ['TKN', '2.5', 5]]);
    assert.ok(calls[0]!.startsWith('https://dead.invalid') && calls[1]!.startsWith('https://rpc.invalid'), 'falls through to the next RPC');
  } finally {
    globalThis.fetch = orig;
  }
});
