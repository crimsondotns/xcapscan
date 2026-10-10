import test from 'node:test';
import assert from 'node:assert/strict';
import { hostOf, limited, limitedFetch, resumeNow, setLimiterTiming } from '../src/limiter.ts';

setLimiterTiming({ gapMs: 1, hostRefillMs: 1 });

/** Response ปลอมแบบย่อ — ต้องมี clone() เพราะคิวแจกผลให้ผู้เรียกหลายคน */
const fake = (status: number, retryAfter: string | null = null) => {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => retryAfter },
    json: async () => ({}),
    clone: () => res,
  };
  return res;
};

test('429 is returned at once (no auto-retry) and raises limited() without pausing', async () => {
  setLimiterTiming({ reset: true });
  let calls = 0;
  (globalThis as { fetch: unknown }).fetch = async () => fake(++calls < 3 ? 429 : 200);
  const res = await limitedFetch('https://x.invalid/a');
  assert.equal(res.status, 429);
  assert.equal(calls, 1, 'ไม่ยิงซ้ำเอง');
  assert.ok(limited(), 'ตั้งธง');
  assert.equal((await limitedFetch('https://x.invalid/b')).status, 429, 'ไม่พัก — ยิงจริงต่อได้');
  assert.equal(calls, 2);
  setLimiterTiming({ reset: true });
});

test('concurrency is capped at 2', async () => {
  setLimiterTiming({ reset: true });
  let inFlight = 0;
  let peak = 0;
  (globalThis as { fetch: unknown }).fetch = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return fake(200);
  };
  await Promise.all(Array.from({ length: 6 }, (_, i) => limitedFetch(`https://x.invalid/${i}`)));
  assert.equal(peak, 2);
});

test('คำขอ URL เดียวกันที่ค้างอยู่พร้อมกัน ยิงจริงครั้งเดียว แล้วแจกผลให้ทุกคน', async () => {
  setLimiterTiming({ reset: true });
  let calls = 0;
  (globalThis as { fetch: unknown }).fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 5));
    return fake(200);
  };
  const all = await Promise.all([limitedFetch('https://x.invalid/same'), limitedFetch('https://x.invalid/same'), limitedFetch('https://x.invalid/other')]);
  assert.equal(calls, 2, 'URL ซ้ำไม่ยิงซ้ำ');
  assert.equal(all.every((r) => r.status === 200), true);
  // ค้างอยู่เท่านั้นที่ใช้ร่วมกัน — ยิงใหม่หลังจบแล้วต้องเป็นคำขอจริงอีกครั้ง (ไม่ใช่แคชถาวร)
  await limitedFetch('https://x.invalid/same');
  assert.equal(calls, 3);
});

test('โดน 429 แล้วบีบท่อ: เหลือทีละ 1 คำขอ และถ่างระยะห่าง', async () => {
  setLimiterTiming({ reset: true, gapMs: 1 });
  (globalThis as { fetch: unknown }).fetch = async () => fake(429);
  const res = await limitedFetch('https://x.invalid/blocked');
  assert.equal(res.status, 429, 'คืน 429 ให้ผู้เรียกตัดสินใจ');

  let inFlight = 0;
  let peak = 0;
  (globalThis as { fetch: unknown }).fetch = async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 3));
    inFlight--;
    return fake(200);
  };
  // host ที่โดน 429 ถูกพักแยก — ดูการบีบท่อรวมจาก host อื่น
  await Promise.all(Array.from({ length: 4 }, (_, i) => limitedFetch(`https://y.invalid/after-${i}`)));
  assert.equal(peak, 1, 'หลังโดนแบน ยิงทีละคำขอเท่านั้น');
});

test('host ที่โดน 429 ไม่ถูกล็อก: resumeNow แล้วยิงจริงได้ทันที', async () => {
  setLimiterTiming({ reset: true });
  let calls = 0;
  (globalThis as { fetch: unknown }).fetch = async () => (calls++ === 0 ? fake(429) : fake(200));
  assert.equal((await limitedFetch('https://banned.invalid/a')).status, 429);
  resumeNow();
  assert.equal(limited(), false);
  assert.equal((await limitedFetch('https://banned.invalid/b')).status, 200);
  assert.equal(calls, 2, 'ยิงจริงอีกครั้ง');
  setLimiterTiming({ reset: true });
});

test('ถังต่อ host: ยิงติดกันได้ตาม burst แล้วที่เหลือรอเติม ไม่ยิงเกินโควตา', async () => {
  setLimiterTiming({ reset: true, hostBurst: 2, hostRefillMs: 40 });
  const at: number[] = [];
  (globalThis as { fetch: unknown }).fetch = async () => {
    at.push(Date.now());
    return fake(200);
  };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: 4 }, (_, i) => limitedFetch(`https://bucket.invalid/${i}`)));
  assert.ok(at[3]! - t0 >= 70, 'คำขอที่ 3–4 ต้องรอเติมถัง');
  setLimiterTiming({ reset: true, hostBurst: 4, hostRefillMs: 1 });
});

test('host ของ URL ที่ห่อด้วย proxy คือ host ข้างใน', () => {
  assert.equal(hostOf('/xcapscan/__proxy?url=https%3A%2F%2Fapi.example.invalid%2Fv1%2Fx'), 'api.example.invalid');
  assert.equal(hostOf('https://api.example.invalid/v1/x?id=1'), 'api.example.invalid');
});
