import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daily, lastTime, netUsd, rowsOfToken, signClassOf, tokenSummary, totals, withinDays } from '../src/flow.ts';
import { matchesGroup, groupExists, tagsOf, familiesOf } from '../src/groups.ts';
import type { Move, TxRow } from '../src/feed.ts';
import { cleanTags, type Wallet } from '../src/store.ts';

const NOW = Date.UTC(2026, 0, 31, 12, 0, 0);
const day = (n: number) => NOW / 1000 - n * 86400;

const move = (over: Partial<Move> = {}): Move => ({ dir: 'in', amount: 1, symbol: 'AAA', name: 'Token A', usd: 100, price: 100, tokenId: null, flagged: false, logo: null, ...over });
const row = (over: Partial<TxRow> = {}): TxRow => ({
  key: Math.random().toString(36).slice(2),
  hash: '0xabc',
  walletId: 'w1',
  chain: 'eth',
  chainLogo: null,
  nativeSymbol: 'ETH',
  time: day(1),
  type: 'receive',
  name: '',
  failed: false,
  flagged: false,
  moves: [move()],
  counterparty: null,
  counterpartyName: null,
  from: null,
  to: null,
  contract: null,
  nonce: null,
  gasUsd: 1,
  gasNative: null,
  raw: {},
  ...over,
});

test('สุทธิของแถว: เข้า − ออก และไม่นับ approve หรือก้อนที่ไม่มีราคา', () => {
  assert.equal(netUsd(row({ moves: [move({ usd: 100 })] })), 100);
  assert.equal(netUsd(row({ moves: [move({ dir: 'out', usd: 40 })] })), -40);
  assert.equal(netUsd(row({ moves: [move({ usd: 100 }), move({ dir: 'out', usd: 30 })] })), 70);
  assert.equal(netUsd(row({ moves: [move({ usd: 100, approve: true })] })), 0);
  assert.equal(netUsd(row({ moves: [move({ usd: null })] })), 0, 'แหล่งข้อมูลไม่ให้ราคา = 0 ไม่ใช่เดาแทน');
  assert.equal(netUsd(row({ moves: [move({ amount: 0, usd: 100 })] })), 0);
});

test('ยอดรวมแยกเข้า/ออก/ค่าเครือข่าย/ติดธง', () => {
  const s = totals([row({ moves: [move({ usd: 100 })] }), row({ moves: [move({ dir: 'out', usd: 25 })], flagged: true, gasUsd: 2 })]);
  assert.deepEqual(s, { net: 75, inUsd: 100, outUsd: -25, fee: 3, flagged: 1, count: 2 });
});

test('ยอดรายวันยาวเท่าจำนวนวันเสมอ แยกเข้า/ออก และตัดวันที่เก่ากว่าช่วงทิ้ง', () => {
  const rows = [
    row({ time: day(0), moves: [move({ usd: 10 })] }),
    row({ time: day(2), moves: [move({ usd: 5 }), move({ dir: 'out', usd: 3 })] }),
    row({ time: day(99), moves: [move({ usd: 1000 })] }),
  ];
  const d = daily(rows, 7, NOW);
  assert.equal(d.length, 7);
  assert.equal(d.at(-1)?.inUsd, 10, 'ช่องสุดท้ายคือวันนี้');
  assert.equal(d[4]?.inUsd, 5);
  assert.equal(d[4]?.outUsd, 3, 'ขาออกเก็บเป็นขนาด (บวก)');
  assert.equal(d[5]?.inUsd, 0, 'วันที่ไม่มีธุรกรรมเป็นศูนย์');
  assert.equal(
    d.reduce((s, p) => s + p.inUsd, 0),
    15,
    'แถวที่เก่ากว่าช่วงที่ขอ ไม่ถูกนับ'
  );
  assert.equal(new Date(d.at(-1)?.at ?? 0).getHours(), 0, 'แต่ละช่องคือเที่ยงคืนของวันนั้น');
});

test('กรองตามช่วงวันและหาเวลาล่าสุด', () => {
  const rows = [row({ time: day(1) }), row({ time: day(40) })];
  assert.equal(withinDays(rows, 30, NOW).length, 1);
  assert.equal(lastTime(rows), day(1));
  assert.equal(lastTime([]), null);
});

test('สรุปรายโทเคน รวมจำนวนและยอดทั้งสองทิศ', () => {
  const rows = [
    row({ moves: [move({ symbol: 'AAA', amount: 2, usd: 200 }), move({ dir: 'out', symbol: 'BBB', amount: 1, usd: 150, name: 'Token B' })] }),
    row({ moves: [move({ dir: 'out', symbol: 'AAA', amount: 1, usd: 100 })] }),
  ];
  const [first, second] = tokenSummary(rows);
  assert.equal(first?.symbol, 'AAA');
  assert.equal(first?.inUsd, 200);
  assert.equal(first?.outUsd, 100);
  assert.equal(first?.inAmount, 2);
  assert.equal(first?.count, 2);
  assert.equal(second?.symbol, 'BBB');
  assert.equal(rowsOfToken(rows, 'BBB').length, 1);
});

test('คลาสสีตามทิศทางเงิน', () => {
  assert.equal(signClassOf(1), 'is-pos');
  assert.equal(signClassOf(-1), 'is-neg');
  assert.equal(signClassOf(0), '');
});

const wallet = (over: Partial<Wallet> = {}): Wallet => ({ id: '0xa', label: 'A', address: '0xa', family: 'erc20', enabled: true, ...over });

test('กลุ่ม: ทั้งหมด/แท็ก/ตระกูลเชน', () => {
  const w = wallet({ tags: ['เก็บยาว', 'ลูกค้า'] });
  const loadedRecently = { loaded: true, last: day(1) };
  assert.equal(matchesGroup('all', w, { loaded: false, last: null }, NOW), true);
  assert.equal(matchesGroup('tag:เก็บยาว', w, loadedRecently, NOW), true);
  assert.equal(matchesGroup('tag:ลูกค้า', w, loadedRecently, NOW), true, 'กระเป๋าใบเดียวอยู่ได้หลายกลุ่มแท็ก');
  assert.equal(matchesGroup('tag:อื่น', w, loadedRecently, NOW), false);
  assert.equal(matchesGroup('tag:เก็บยาว', wallet(), loadedRecently, NOW), false, 'ไม่มีแท็กเลย = ไม่อยู่กลุ่มแท็กไหน');
  assert.equal(matchesGroup('chain:erc20', w, loadedRecently, NOW), true);
  assert.equal(matchesGroup('chain:sol', w, loadedRecently, NOW), false);
});

test('รายชื่อแท็ก/ตระกูลเชนมาจากกระเป๋าจริง และกลุ่มที่ไม่มีแล้วถือว่าหายไป', () => {
  const list = [wallet({ id: '1', tags: ['ข', 'ก'] }), wallet({ id: '2', tags: ['ก'] }), wallet({ id: '3' })];
  assert.deepEqual(tagsOf(list), ['ก', 'ข'], 'ไม่ซ้ำ เรียงตามตัวอักษร');
  assert.deepEqual(familiesOf(list), ['erc20']);
  assert.equal(groupExists('tag:ก', list), true);
  assert.equal(groupExists('tag:ไม่มี', list), false);
  assert.equal(groupExists('chain:sol', list), false);
  assert.equal(groupExists('all', list), true);
});

test('แท็กถูกล้างก่อนบันทึก: ตัดช่องว่าง ทิ้งตัวว่าง ไม่เอาซ้ำ คงลำดับเดิม', () => {
  assert.deepEqual(cleanTags([' เก็บยาว ', 'ลูกค้า', 'เก็บยาว', '', '   ']), ['เก็บยาว', 'ลูกค้า']);
  assert.deepEqual(cleanTags([]), []);
});

/* ---- ค่าที่ฝังตอน build ต้องไปถึงเบราว์เซอร์ที่เคยเปิดไว้แล้ว ---- */
import { applyBuildConfig, type BuildConfig } from '../src/store.ts';

const cfgOf = (over: Partial<BuildConfig> = {}): BuildConfig => ({ endpoints: [{ id: 'c1', name: 'จาก build', url: 'https://one.example.invalid/{address}', family: 'erc20', enabled: true }], chainListUrl: 'https://list.example.invalid/new', chains: [{ id: 'sol', name: 'Solana', explorer: 'https://scan.example.invalid' }], fingerprint: 'aaa', ...over });
const savedOf = (over: Partial<Parameters<typeof applyBuildConfig>[0]> = {}) => ({ endpoints: [{ id: 's1', name: 'ของเดิม', url: 'https://old.example.invalid/{address}', family: 'erc20' as const, enabled: true }], chainListUrl: 'https://list.example.invalid/old', chains: [], ...over });

test('ค่าที่ฝังตอน build เปลี่ยน → เครื่องที่เคยเปิดไว้รับค่าใหม่ (ไม่ยึดสำเนาเก่าตลอดไป)', () => {
  const out = applyBuildConfig(savedOf({ cfg: 'เก่า' }), cfgOf());
  assert.equal(out.chainListUrl, 'https://list.example.invalid/new');
  assert.equal(out.endpoints[0]?.id, 'c1');
  assert.equal(out.chains[0]?.explorer, 'https://scan.example.invalid');
});

test('ลายนิ้วมือเท่าเดิม → ของในเครื่องชนะ (ไม่ทับของที่กู้คืนมาจากไฟล์สำรอง)', () => {
  const out = applyBuildConfig(savedOf({ cfg: 'aaa' }), cfgOf());
  assert.equal(out.chainListUrl, 'https://list.example.invalid/old');
  assert.equal(out.endpoints[0]?.id, 's1');
  assert.equal(out.chains.length, 1, 'เชนจาก build ที่ยังไม่มีในเครื่อง ยังถูกเติมให้');
});

test('เครื่องยังว่าง → เติมจาก build ให้ทั้งชุด', () => {
  const out = applyBuildConfig({ endpoints: [], chainListUrl: '', chains: [], cfg: 'aaa' }, cfgOf());
  assert.equal(out.endpoints[0]?.id, 'c1');
  assert.equal(out.chainListUrl, 'https://list.example.invalid/new');
});

test('build ไม่ได้ตั้งค่าอะไรเลย (dev) → ไม่ไปลบของในเครื่อง', () => {
  const out = applyBuildConfig(savedOf({ cfg: 'เก่า', chains: [{ id: 'sol', name: 'ของฉัน' }] }), { endpoints: [], chainListUrl: '', chains: [], fingerprint: '' });
  assert.equal(out.endpoints[0]?.id, 's1');
  assert.equal(out.chainListUrl, 'https://list.example.invalid/old');
  assert.equal(out.chains[0]?.name, 'ของฉัน');
});

test('เชนที่ผู้ใช้มีเองและไม่ชนกับ build ยังอยู่ครบหลังค่าเปลี่ยน', () => {
  const out = applyBuildConfig(savedOf({ cfg: 'เก่า', chains: [{ id: 'sol', name: 'ทับของ build' }, { id: 'base', name: 'ของฉัน' }] }), cfgOf());
  assert.equal(out.chains.find((c) => c.id === 'sol')?.name, 'Solana', 'id ที่ชนกัน ค่าใหม่จาก build ชนะ');
  assert.equal(out.chains.find((c) => c.id === 'base')?.name, 'ของฉัน');
});

/* ---- สแปมแจกเหรียญ: รับเข้าอย่างเดียว ไม่มีมูลค่า ไม่ได้จ่ายค่าธรรมเนียม ---- */
import { markRisk, worthlessAirdrop } from '../src/feed.ts';

test('เหรียญไร้มูลค่าที่ถูกโยนเข้ามา = น่าสงสัย และโทเคนถูกติดธงด้วย', () => {
  const spam = row({ type: 'receive', gasUsd: null, moves: [move({ amount: 39_550_011, symbol: 'OUTLAW', usd: 0, price: 0.001417 })] });
  assert.equal(worthlessAirdrop(spam), true);
  const [marked] = markRisk([spam]);
  assert.equal(marked?.flagged, true);
  assert.equal(marked?.moves[0]?.flagged, true, 'โทเคนเองก็ต้องถูกติดธง');
  assert.equal(tokenSummary([marked!])[0]?.flagged, true);
});

test('ไม่เหมาเข่ง: มีมูลค่า · จ่ายค่าธรรมเนียมเอง · มีขาออก · หน่วยยังดิบ → ไม่ติดธง', () => {
  assert.equal(worthlessAirdrop(row({ type: 'receive', gasUsd: null, moves: [move({ usd: 12 })] })), false, 'มีมูลค่า');
  assert.equal(worthlessAirdrop(row({ type: 'receive', gasUsd: 0.4, moves: [move({ usd: 0 })] })), false, 'เราจ่ายค่าธรรมเนียมเอง = เราเป็นคนทำเอง');
  assert.equal(worthlessAirdrop(row({ type: 'swap', gasUsd: null, moves: [move({ usd: 0 }), move({ dir: 'out', usd: 0 })] })), false, 'มีขาออก');
  assert.equal(worthlessAirdrop(row({ type: 'receive', gasUsd: null, moves: [move({ usd: null, rawUnits: true })] })), false, 'ยังไม่รู้ decimals ตัดสินไม่ได้');
  assert.equal(worthlessAirdrop(row({ type: 'receive', gasUsd: null, moves: [] })), false, 'ไม่มีเหรียญเคลื่อนเลย');
});

test('markRisk ไม่ถอดธงที่แหล่งข้อมูลติดมาแล้ว', () => {
  const fromSource = row({ type: 'send', flagged: true, moves: [move({ dir: 'out', usd: 50 })] });
  assert.equal(markRisk([fromSource])[0]?.flagged, true);
});

