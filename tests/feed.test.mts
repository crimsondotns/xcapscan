import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/importWallets.ts';
import { detectEndpoint, parseAddress } from '../src/store.ts';
import { rowValue } from '../src/components/TxTable.tsx';
import { applyTokenMeta, buildUrl, fetchPage, lookalike, parseTokenMeta, prettyProjectId, toTemplate, unknownTokens } from '../src/feed.ts';
import { metaUrl } from '../src/tokens.ts';
import { protocolKind } from '../src/kind.ts';

const ME = '0x42a8000000000000000000000000000000000000';
const fixture = {
  cate_dict: {},
  project_dict: { arb_dex: { id: 'arb_dex', chain: 'arb', name: 'Some DEX' } },
  token_dict: {
    arb: { id: 'arb', chain: 'arb', symbol: 'ETH', price: 2000, is_scam: false, logo_url: 'https://img.invalid/eth.png' },
    '0xaaaa': { id: '0xaaaa', chain: 'arb', symbol: 'USDC', optimized_symbol: 'USDC', price: 1 },
    '0xbad0': { id: '0xbad0', chain: 'base', symbol: 'AIRDROP', price: 0, is_scam: true },
  },
  history_list: [
    { id: '0x01', idx: 0, chain: 'arb', time_at: 1700000300, project_id: 'arb_dex', other_addr: '0xrouter', sends: [{ amount: 0.5, token_id: 'arb', price: 2000 }], receives: [{ amount: 1000, token_id: '0xaaaa', price: 1 }], tx: { name: 'swap', status: 1, usd_gas_fee: 0.12 } },
    { id: '0x02', idx: 0, chain: 'base', time_at: 1700000200, is_scam: true, other_addr: '0xspam', sends: [], receives: [{ amount: 1e6, token_id: '0xbad0', price: 0 }], tx: { name: 'batchTransfer', status: 1 } },
    { id: '0x03', idx: 0, chain: 'arb', time_at: 1700000100, sends: [], receives: [], token_approve: { spender: '0xrouter', token_id: '0xaaaa', value: 1e9 }, tx: { name: 'approve', status: 1, usd_gas_fee: 0.05 } },
    { id: '0x04', idx: 0, chain: 'arb', time_at: 1700000000, sends: [{ amount: 1, token_id: 'arb' }], receives: [], tx: { name: '', status: 0, from_addr: ME, to_addr: '0xfriend' } },
  ],
};

const mock = (body: unknown, ok = true, status = 200) => {
  (globalThis as { fetch: unknown }).fetch = async () => ({ ok, status, json: async () => body });
};

test('history_list shape → rows, types, flags, cursor', async () => {
  mock(fixture);
  const page = await fetchPage('https://x.invalid/h?id={address}&s={start}&c={count}', 'w1', ME, null, 4);
  assert.deepEqual(page.rows.map((r) => r.type), ['swap', 'receive', 'approve', 'send']);
  assert.equal(page.rows[0]!.counterpartyName, 'Some DEX');
  assert.equal(page.rows[0]!.moves[1]!.usd, 1000);
  assert.equal(page.rows[0]!.moves[0]!.price, 2000);
  assert.equal(page.rows[0]!.moves[0]!.logo, 'https://img.invalid/eth.png');
  assert.equal(page.rows[0]!.chainLogo, null);
  assert.equal(page.rows[0]!.nativeSymbol, 'ETH');
  assert.equal(page.rows[0]!.moves[1]!.logo, null);
  assert.equal(page.rows[1]!.flagged, true);
  assert.equal(page.rows[3]!.failed, true);
  assert.equal(page.rows[3]!.counterparty, '0xfriend');
  assert.deepEqual(page.next, { start: 1700000000, cursor: '0x04', offset: 4 });
});

test('flat list shape (result[]) with wei values', async () => {
  mock({ result: [{ hash: '0xabc', from: '0xaa', to: '0xbb', value: '1000000000000000000', timeStamp: '1700000000', isError: '0' }] });
  const page = await fetchPage('https://x.invalid/{address}', 'w', '0xaa', null, 20);
  assert.equal(page.rows[0]!.type, 'send');
  assert.equal(page.rows[0]!.moves[0]!.amount, 1);
});

test('unknown shape and HTTP errors are typed', async () => {
  mock({ hello: 1 });
  await assert.rejects(fetchPage('https://x.invalid/{address}', 'w', '0xaa', null, 20), { kind: 'shape' });
  mock({}, false, 404);
  await assert.rejects(fetchPage('https://x.invalid/{address}', 'w', '0xaa', null, 20), { kind: 'http', status: 404 });
});

test('csv: quotes, embedded commas, CRLF, multi-line cell', () => {
  const g = parseCsv('Label,Addresses\r\n"Main, one",0x1111111111111111111111111111111111111111\nTwo,"0x2222222222222222222222222222222222222222\n0x3333333333333333333333333333333333333333"\n');
  assert.deepEqual(g[0], ['Label', 'Addresses']);
  assert.equal(g[1]![0], 'Main, one');
  assert.equal(g.length, 3);
  assert.ok(g[2]![1]!.includes('\n'));
});

test('buildUrl fills every placeholder', () => {
  assert.equal(buildUrl('https://a.invalid/?id={address}&s={start}&c={count}&b={cursor}', '0xAB', { start: 5, cursor: 'sig', offset: 0 }, 9), 'https://a.invalid/?id=0xAB&s=5&c=9&b=sig');
  assert.equal(buildUrl('https://a.invalid/{address}?s={start}&b={cursor}', 'x', null, 9), 'https://a.invalid/x?s=0');
});

const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
test('signature-list shape (Solana family)', async () => {
  mock([
    { signature: 'sigA', timestamp: 1700000500, type: 'SWAP', fee: 5000, feePayer: SOL, nativeTransfers: [{ fromUserAccount: SOL, toUserAccount: 'pool', amount: 2e9 }], tokenTransfers: [{ fromUserAccount: 'pool', toUserAccount: SOL, tokenAmount: 100, mint: 'MintAAAAAAAA', symbol: 'USDC' }] },
    { signature: 'sigB', timestamp: 1700000400, type: 'TRANSFER', fee: 5000, feePayer: 'someone', transactionError: null, nativeTransfers: [{ fromUserAccount: 'someone', toUserAccount: SOL, amount: 5e8 }], tokenTransfers: [] },
  ]);
  const page = await fetchPage('https://x.invalid/{address}?before={cursor}', 'w', SOL, null, 20);
  assert.deepEqual(page.rows.map((r) => r.type), ['swap', 'receive']);
  assert.equal(page.rows[0]!.moves[0]!.amount, 2);
  assert.equal(page.rows[1]!.moves[0]!.amount, 0.5);
  assert.equal(page.rows[1]!.counterparty, 'someone');
  assert.deepEqual(page.next, { start: 1700000400, cursor: 'sigB', offset: 2 });
});

test('parseAddress: ERC-20 lowercased, Solana kept as-is, junk rejected', () => {
  assert.deepEqual(parseAddress(' 0xABCDEFabcdef0123456789ABCDEFabcdef012345 '), { address: '0xabcdefabcdef0123456789abcdefabcdef012345', family: 'erc20' });
  assert.deepEqual(parseAddress(SOL), { address: SOL, family: 'sol' });
  assert.equal(parseAddress('0x123'), null);
  assert.equal(parseAddress('0OIl' + 'a'.repeat(30)), null);
});

test('detectEndpoint: family and name from the URL alone', () => {
  assert.deepEqual(detectEndpoint('https://api.example.com/v1/history?id={address}'), { name: 'example.com', family: 'erc20' });
  assert.deepEqual(detectEndpoint('https://solana.example.org/{address}'), { name: 'solana.example.org', family: 'sol' });
  assert.deepEqual(detectEndpoint('https://example.net/sol/txs?a={address}'), { name: 'example.net', family: 'sol' });
  assert.equal(detectEndpoint('http://example.com/{address}'), null);
  assert.equal(detectEndpoint('not a url'), null);
});

test('base URL without placeholders gets the query composed', () => {
  assert.equal(toTemplate('https://a.invalid/v1/history?'), 'https://a.invalid/v1/history?id={address}&start_time={start}&page_count={count}');
  assert.equal(toTemplate('https://a.invalid/v1/history'), 'https://a.invalid/v1/history?id={address}&start_time={start}&page_count={count}');
  assert.equal(toTemplate('https://a.invalid/h?x=1'), 'https://a.invalid/h?x=1&id={address}&start_time={start}&page_count={count}');
  assert.equal(toTemplate('https://a.invalid/h?id={address}'), 'https://a.invalid/h?id={address}');
  assert.equal(buildUrl('https://a.invalid/v1/history?', '0xAB', null, 20), 'https://a.invalid/v1/history?id=0xAB&start_time=0&page_count=20');
});

test('lookalike symbols (non-ASCII homoglyphs) are flagged', () => {
  assert.equal(lookalike('HYPE'), false);
  assert.equal(lookalike('H\u1EF4PE'), true);
  assert.equal(lookalike('USDC'), false);
});

test('rowValue: moved value, not net', () => {
  const base = { key: '', hash: '', walletId: '', chain: '', chainLogo: null, time: 0, type: 'swap' as const, name: '', failed: false, flagged: false, counterparty: null, counterpartyName: null, gasUsd: null, raw: {} };
  const mv = (dir: 'in' | 'out', amount: number, usd: number | null) => ({ dir, amount, usd, price: null, symbol: 'X', flagged: false, logo: null });
  assert.deepEqual(rowValue({ ...base, moves: [mv('out', 293, 116.09), mv('in', 0.04, 116.42), mv('out', 0, null)] }), { value: 116.42, sign: '' });
  assert.deepEqual(rowValue({ ...base, moves: [mv('out', 2, 191.06)] }), { value: 191.06, sign: '−' });
  assert.deepEqual(rowValue({ ...base, moves: [mv('in', 5, 3.82)] }), { value: 3.82, sign: '+' });
  assert.equal(rowValue({ ...base, moves: [mv('out', 2, null)] }), null);
});

test('price cache: remembers newest price per token, fills USD, builds price request URL', async () => {
  const { rememberPrice, priceOf, usdOf, priceRequestUrl, refreshPrice } = await import('../src/prices.ts');
  rememberPrice('arb', '0xabc', 'ARROW', 0.43, 100);
  rememberPrice('arb', '0xabc', 'ARROW', 0.40, 50); // เก่ากว่า → ไม่ทับ
  assert.equal(priceOf('arb', '0xabc', 'ARROW'), 0.43);
  assert.equal(usdOf(10, null, 'arb', '0xabc', 'ARROW'), 4.3);
  assert.equal(usdOf(10, 99, 'arb', '0xabc', 'ARROW'), 99);
  assert.equal(priceOf('arb', '0xzzz', 'NOPE'), null);
  assert.equal(priceRequestUrl('https://example.invalid/p/{chain}/{token}', 'arb', '0xabc', 'ARROW'), 'https://example.invalid/p/arb/0xabc');
  assert.equal(priceRequestUrl('https://example.invalid/p', 'arb', null, 'ETH'), 'https://example.invalid/p?chain=arb&token=ETH');
  const calls: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (u: string) => {
    calls.push(u);
    return { ok: true, json: async () => ({ data: { price: '2734.64' } }) };
  };
  assert.equal(await refreshPrice('https://example.invalid/p', 'arb', null, 'ETH'), 2734.64);
  assert.equal(await refreshPrice('https://example.invalid/p', 'arb', null, 'ETH'), 2734.64); // สดอยู่ → ไม่ยิงซ้ำ
  assert.equal(calls.length, 1);
  assert.equal(await refreshPrice('', 'arb', null, 'ETH'), 2734.64); // ไม่มี URL → ใช้แคช
});

test('sol family composes owner query; placeholders still drop empty cursor params', () => {
  assert.equal(buildUrl('https://example.invalid/tx', 'So1ana', null, 30, 'sol'), 'https://example.invalid/tx?ownerAddress=So1ana&limit=30');
  assert.equal(buildUrl('https://example.invalid/tx?x=1', 'So1ana', null, 5, 'sol'), 'https://example.invalid/tx?x=1&ownerAddress=So1ana&limit=5');
  assert.equal(buildUrl('https://example.invalid/tx/{address}?limit={count}&before={cursor}', 'So1ana', { start: 1, cursor: 'sig1', offset: 0 }, 30, 'sol'), 'https://example.invalid/tx/So1ana?limit=30&before=sig1');
});

test('token metadata: batch URL, tolerant parser, merge into rows', async () => {
  assert.equal(metaUrl('https://example.invalid/meta', ['A', 'B']), 'https://example.invalid/meta?tokenAddresses=A%2CB');
  assert.equal(metaUrl('https://example.invalid/meta?ids={addresses}', ['A']), 'https://example.invalid/meta?ids=A');
  const meta = parseTokenMeta({ data: [{ address: 'MintAAAAAAAA', name: 'USD Coin', symbol: 'USDC', decimals: 6, logoURI: 'https://img.invalid/usdc.png' }] });
  assert.equal(meta.get('MintAAAAAAAA')?.name, 'USD Coin');
  assert.equal(metaUrl('https://example.invalid/assets/search?query=', ['A', 'B']), 'https://example.invalid/assets/search?query=A%2CB');
  const jup = parseTokenMeta([{ id: 'MintJ', name: 'Unicorn Fart Dust', symbol: 'UFD', decimals: 6, icon: 'https://img.invalid/ufd.png' }]);
  assert.equal(jup.get('MintJ')?.symbol, 'UFD');
  assert.equal(jup.get('MintJ')?.decimals, 6);
  assert.equal(jup.get('MintJ')?.logo, 'https://img.invalid/ufd.png');
  const meta2 = parseTokenMeta({ MintB: { symbol: 'B', name: 'Bee' } });
  assert.equal(meta2.get('MintB')?.symbol, 'B');
  mock([{ signature: 'sigA', timestamp: 1700000500, type: 'TRANSFER', fee: 5000, feePayer: SOL, nativeTransfers: [], tokenTransfers: [{ fromUserAccount: 'pool', toUserAccount: SOL, tokenAmount: 100, mint: 'MintAAAAAAAA' }] }]);
  const page = await fetchPage('https://x.invalid/{address}', 'w', SOL, null, 20);
  assert.deepEqual(unknownTokens(page.rows), ['MintAAAAAAAA']);
  const rows = applyTokenMeta(page.rows, meta);
  assert.equal(rows[0]!.moves[0]!.symbol, 'USDC');
  assert.equal(rows[0]!.moves[0]!.name, 'USD Coin');
  assert.equal(rows[0]!.moves[0]!.logo, 'https://img.invalid/usdc.png');
});

test('protocol name falls back to project_id when project_dict lacks it', async () => {
  mock({ history_list: [{ id: '0xp', idx: 0, chain: 'arb', time_at: 1789891479, project_id: 'arb_lifiprotocol', other_addr: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', sends: [{ amount: 880, price: 1, token_id: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', to_addr: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae' }], receives: [], tx: { name: 'swapAndStartBridgeTokensViaLiFiIntentEscrowV2', status: 1, from_addr: ME, to_addr: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae', eth_gas_fee: 0.000056, usd_gas_fee: 0.148 } }], token_dict: {}, project_dict: {} });
  const page = await fetchPage('https://x.invalid/{address}', 'w', ME, null, 20);
  assert.equal(page.rows[0]!.counterpartyName, 'Lifiprotocol');
  assert.equal(prettyProjectId('eth_uniswap-v3', 'eth'), 'Uniswap V3');
});

test('protocolKind: bridge beats swap in method name; plain swap with a project is DEX', async () => {
  mock({ history_list: [
    { id: '0xb', idx: 0, chain: 'arb', time_at: 1789891479, project_id: 'arb_lifiprotocol', sends: [{ amount: 880, price: 1, token_id: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' }], receives: [], tx: { name: 'swapAndStartBridgeTokensViaLiFiIntentEscrowV2', status: 1, from_addr: ME, to_addr: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae' } },
    { id: '0xs', idx: 0, chain: 'arb', time_at: 1789891400, project_id: 'arb_somedex', sends: [{ amount: 1, price: 1, token_id: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' }], receives: [{ amount: 2, price: 0.5, token_id: '0x0000000000000000000000000000000000000001' }], tx: { name: 'execute', status: 1, from_addr: ME, to_addr: '0x2' } },
    { id: '0xa', idx: 0, chain: 'arb', time_at: 1789891300, project_id: 'arb_x', sends: [{ amount: 1, price: 1, token_id: '0xaf88d065e77c8cc2239327c5edb3a432268e5831' }], receives: [{ amount: 2, price: 0.5, token_id: '0x0000000000000000000000000000000000000001' }], tx: { name: 'unoswapTo', status: 1, from_addr: ME, to_addr: '0x2' } },
  ], token_dict: {}, project_dict: {} });
  const page = await fetchPage('https://x.invalid/{address}', 'w', ME, null, 20);
  assert.deepEqual(page.rows.map((r) => protocolKind(r)), ['bridge', 'dex', 'aggregator']);
});

test('token transfer: To is the recipient from sends[].to_addr, not the token contract in tx.to_addr', async () => {
  mock({ history_list: [
    { cate_id: 'send', id: '0x90af', idx: 0, chain: 'hood', time_at: 1788932197, other_addr: '0x498e711800dbdff630bc1e5c4598749b5826e2b2', receives: [], sends: [{ amount: 7106.129, price: null, to_addr: '0x498e711800dbdff630bc1e5c4598749b5826e2b2', token_id: '0xe8ffd7e24187f72afb08d75b1bb13088a989a791' }], tx: { name: 'transfer', status: 1, from_addr: ME, to_addr: '0xe8ffd7e24187f72afb08d75b1bb13088a989a791', value: 0, eth_gas_fee: 0.00001, usd_gas_fee: 0.02 } },
    { cate_id: 'receive', id: '0x91', idx: 0, chain: 'hood', time_at: 1788932100, other_addr: '0x498e711800dbdff630bc1e5c4598749b5826e2b2', receives: [{ amount: 5, price: null, from_addr: '0x498e711800dbdff630bc1e5c4598749b5826e2b2', token_id: '0xe8ffd7e24187f72afb08d75b1bb13088a989a791' }], sends: [], tx: { name: 'transfer', status: 1, from_addr: '0x498e711800dbdff630bc1e5c4598749b5826e2b2', to_addr: '0xe8ffd7e24187f72afb08d75b1bb13088a989a791', value: 0 } },
  ], token_dict: {}, project_dict: {} });
  const page = await fetchPage('https://x.invalid/{address}', 'w', ME, null, 20);
  assert.equal(page.rows[0]!.to, '0x498e711800dbdff630bc1e5c4598749b5826e2b2');
  assert.equal(page.rows[0]!.from, ME);
  assert.equal(page.rows[1]!.from, '0x498e711800dbdff630bc1e5c4598749b5826e2b2');
  assert.equal(page.rows[1]!.to, ME, 'receive-only: To is this wallet, not the sender (other_addr)');
});

test('approve: allowance move flagged (not a send), To is the spender, contract is the token', async () => {
  mock({ history_list: [{ cate_id: 'approve', id: '0x655e', idx: 0, chain: 'hood', time_at: 1790045593, other_addr: '0x0000000000001ff3684f28c67538d4d072c22734', project_id: 'hood_0x', receives: [], sends: [], token_approve: { spender: '0x0000000000001ff3684f28c67538d4d072c22734', token_id: '0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03', value: 293.69 }, tx: { name: 'approve', status: 1, from_addr: ME, to_addr: '0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03', value: 0 } }], token_dict: {}, project_dict: {} });
  const page = await fetchPage('https://x.invalid/{address}', 'w', ME, null, 20);
  const r = page.rows[0]!;
  assert.equal(r.type, 'approve');
  assert.equal(r.moves[0]!.approve, true);
  assert.equal(r.to, '0x0000000000001ff3684f28c67538d4d072c22734');
  assert.equal(r.contract, '0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03');
  assert.equal(rowValue(r), null);
});

test('empty params in the pasted URL are filled, not duplicated; extra params kept', () => {
  assert.equal(buildUrl('https://example.invalid/acts?ownerAddress', 'So1', null, 100, 'sol'), 'https://example.invalid/acts?ownerAddress=So1&limit=100');
  assert.equal(buildUrl('https://example.invalid/acts?ownerAddress', 'So1', { start: 1, cursor: 'x', offset: 200 }, 100, 'sol'), 'https://example.invalid/acts?ownerAddress=So1&limit=100&offset=200');
  assert.equal(buildUrl('https://example.invalid/acts?ownerAddress=&limit=&isRouter=true', 'So1', null, 100, 'sol'), 'https://example.invalid/acts?ownerAddress=So1&limit=100&isRouter=true');
  assert.equal(buildUrl('https://example.invalid/acts?ownerAddress=&limit=&isRouter=true', 'So1', { start: 1, cursor: 'x', offset: 100 }, 100, 'sol'), 'https://example.invalid/acts?ownerAddress=So1&limit=100&isRouter=true&offset=100');
  assert.equal(buildUrl('https://example.invalid/acts?isRouter=true', 'So1', null, 100, 'sol'), 'https://example.invalid/acts?isRouter=true&ownerAddress=So1&limit=100');
  assert.equal(buildUrl('https://example.invalid/h?id=', '0xAB', null, 20), 'https://example.invalid/h?id=0xAB&start_time=0&page_count=20');
  assert.equal(metaUrl('https://example.invalid/meta?tokenAddresses=', ['A', 'B']), 'https://example.invalid/meta?tokenAddresses=A%2CB');
});

test('trade-list shape (Solana): buy/sell legs, raw token units converted once decimals arrive', async () => {
  mock([{ tokenAddress: '463SK47VkB7uE7XenTHKiVcMtxRsfNE2X4Q9wByaURVA', signature: '2AWQ', time: '2026-09-21T03:18:13.000Z', tokenAmount: '25946399405173', solAmount: '1265039288', solPrice: 0.000048755870448359, usdPrice: 0.005438323252110719, isBuy: false }]);
  const page = await fetchPage('https://x.invalid/{address}', 'w', SOL, null, 20);
  const r = page.rows[0]!;
  assert.equal(r.type, 'swap');
  assert.equal(r.time, Math.floor(Date.parse('2026-09-21T03:18:13.000Z') / 1000));
  assert.deepEqual(r.moves.map((m) => [m.dir, m.symbol]), [['out', '463SK4…'], ['in', 'SOL']]);
  assert.equal(r.moves[0]!.rawUnits, true);
  assert.equal(r.moves[1]!.amount, 1.265039288);
  assert.ok(Math.abs((r.moves[1]!.usd ?? 0) - 1.265039288 * (0.005438323252110719 / 0.000048755870448359)) < 1e-6);
  assert.deepEqual(unknownTokens(page.rows), ['463SK47VkB7uE7XenTHKiVcMtxRsfNE2X4Q9wByaURVA']);
  const rows = applyTokenMeta(page.rows, parseTokenMeta([{ address: '463SK47VkB7uE7XenTHKiVcMtxRsfNE2X4Q9wByaURVA', symbol: 'ABC', name: 'Abc Coin', decimals: 6 }]));
  const m = rows[0]!.moves[0]!;
  assert.equal(m.symbol, 'ABC');
  assert.equal(m.amount, 25946399.405173);
  assert.equal(m.rawUnits, undefined);
  assert.ok(Math.abs((m.usd ?? 0) - 25946399.405173 * 0.005438323252110719) < 1e-6);
});

test('transfers + pnl-activity shapes with next-token paging', async () => {
  mock({ transfers: [{ txHash: 'h1', blockTime: '2026-09-21T03:11:28.000Z', assetId: 'So11111111111111111111111111111111111111112', amount: 4.627479137, amountRaw: 4627479137, usdVolume: 515.07, fromAddress: SOL, toAddress: 'other', feeAmount: 0.000079934, feePayer: SOL }], next: '1784143601' });
  let page = await fetchPage('https://d.invalid/transfers/{address}?offset={offset}', 'w', SOL, null, 1);
  assert.equal(page.rows[0]!.type, 'send');
  assert.equal(page.rows[0]!.moves[0]!.amount, 4.627479137);
  assert.equal(page.rows[0]!.gasNative, 0.000079934);
  assert.equal(page.next?.next, '1784143601');
  assert.equal(buildUrl('https://d.invalid/transfers/{address}?offset={offset}', SOL, page.next, 1), `https://d.invalid/transfers/${SOL}?offset=1784143601`);

  mock({ [SOL]: { isBlackListed: false, next: '428931412000765000', userTrades: [{ type: 'sell', assetId: 'Mint1', amount: 25946.399405173, price: 0.00543, nativeVolume: 1.265039288, usdVolume: 140.89, blockTime: '2026-09-21T03:18:13.000Z', txHash: 'h2', actionId: 'a1', signerId: SOL }] } });
  page = await fetchPage('https://d.invalid/pnl-activity?address={address}&offset={offset}', 'w', SOL, null, 1);
  const r = page.rows[0]!;
  assert.equal(r.type, 'swap');
  assert.deepEqual(r.moves.map((m) => [m.dir, m.symbol, m.amount]), [['out', 'Mint1', 25946.399405173], ['in', 'SOL', 1.265039288]]);
  assert.equal(page.next?.next, '428931412000765000');
});
