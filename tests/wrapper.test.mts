import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, carriesClientAuth, mapRoute, parseRoute, safeQuery, upstreamUrl } from '../worker/src/validate.ts';
import { resolveUrl, setWrapper, usableUrl, viaWrapper } from '../src/proxy.ts';

const WRAP = 'https://wrapper.example.invalid';

test('route: only /s/<alias>/<path>, no open proxy', () => {
  assert.deepEqual(parseRoute('/s/main/v1/transfers/abc'), { alias: 'main', path: 'v1/transfers/abc' });
  assert.equal(parseRoute('/p?url=https://elsewhere.invalid'), null);
  assert.equal(parseRoute('/s/main/../../etc/passwd'), null);
  assert.equal(parseRoute('/s/main/%2e%2e%2fsecret'), null);
  assert.equal(parseRoute('/s/MAIN/v1'), null);
  assert.equal(parseRoute('/'), null);
});

test('query: drops credential params, caps size', () => {
  const q = safeQuery(new URLSearchParams('limit=100&api_key=leak&authorization=x&offset=200'));
  assert.equal(q?.toString(), 'limit=100&offset=200');
  assert.equal(safeQuery(new URLSearchParams(`a=${'x'.repeat(5000)}`)), null);
});

test('origin: exact match only', () => {
  const list = 'https://user.github.io, https://example.invalid';
  assert.equal(allowedOrigin('https://user.github.io', list), 'https://user.github.io');
  assert.equal(allowedOrigin('https://user.github.io.evil.invalid', list), null);
  assert.equal(allowedOrigin(null, list), null);
  assert.equal(allowedOrigin('https://user.github.io', undefined), null);
});

test('client must not carry its own credentials', () => {
  assert.equal(carriesClientAuth(new Headers({ accept: 'application/json' })), false);
  assert.equal(carriesClientAuth(new Headers({ authorization: 'Bearer x' })), true);
  assert.equal(carriesClientAuth(new Headers({ 'x-api-key': 'x' })), true);
});

test('upstream url: https only, query preserved', () => {
  assert.equal(upstreamUrl('https://api.example.invalid/v1', 'transfers/abc', new URLSearchParams('limit=100')), 'https://api.example.invalid/v1/transfers/abc?limit=100');
  assert.equal(upstreamUrl('http://api.example.invalid', 'x', new URLSearchParams()), null);
});

test('หน้าเว็บ: แม่แบบแบบชื่อย่อวิ่งผ่าน wrapper, URL เต็มยิงตรงเหมือนเดิม', () => {
  setWrapper(WRAP);
  assert.equal(viaWrapper('main/v1/transfers/{address}'), true);
  assert.equal(viaWrapper('https://api.example.invalid/x'), false);
  assert.equal(resolveUrl('main/v1/transfers/0xabc'), `${WRAP}/s/main/v1/transfers/0xabc`);
  assert.equal(resolveUrl('https://api.example.invalid/x'), 'https://api.example.invalid/x');
  assert.equal(usableUrl('main/v1'), true);
  setWrapper('');
  assert.equal(usableUrl('main/v1'), false);
  assert.equal(usableUrl('https://api.example.invalid/x'), true);
});

test('ชื่อเส้นทางกลางๆ ถูกแปลงเป็น path จริงที่ฝั่งเซิร์ฟเวอร์ คีย์ที่ไม่รู้จักถูกปฏิเสธ', () => {
  const routes = JSON.stringify({ t: 'v1/transfers', p: 'v1/pnl-activity', m: 'v1/assets/search' });
  assert.equal(mapRoute('t/9xQe', routes), 'v1/transfers/9xQe');
  assert.equal(mapRoute('p', routes), 'v1/pnl-activity');
  assert.equal(mapRoute('m', routes), 'v1/assets/search');
  // คีย์ที่ไม่ได้ประกาศ = เปิดทางไปที่อื่นในปลายทางไม่ได้
  assert.equal(mapRoute('v1/transfers/9xQe', routes), null);
  assert.equal(mapRoute('x', routes), null);
  // ไม่ได้ตั้งตาราง = ส่ง path ผ่านตามเดิม (ใช้กับ alias ที่ไม่ต้องปิดชื่อเส้นทาง)
  assert.equal(mapRoute('v1/transfers/9xQe', undefined), 'v1/transfers/9xQe');
  assert.equal(mapRoute('t', 'not json'), null);
});
