import test from 'node:test';
import assert from 'node:assert/strict';
import { backoff, limitedFetch, pausedFor, setLimiterTiming } from '../src/limiter.ts';

setLimiterTiming({ gapMs: 1, basePauseMs: 10 });

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

test('429 is returned at once (no auto-retry) and pauses the whole queue', async () => {
  setLimiterTiming({ reset: true, basePauseMs: 50 });
  let calls = 0;
  (globalThis as { fetch: unknown }).fetch = async () => fake(++calls < 3 ? 429 : 200);
  const res = await limitedFetch('https://x.invalid/a');
  assert.equal(res.status, 429);
  assert.equal(calls, 1, 'ไม่ยิงซ้ำเอง');
  assert.ok(pausedFor() > 0, 'คิวถูกพัก');
  setLimiterTiming({ reset: true, basePauseMs: 10 });
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
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 2 });
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
  await Promise.all(Array.from({ length: 4 }, (_, i) => limitedFetch(`https://x.invalid/after-${i}`)));
  assert.equal(peak, 1, 'หลังโดนแบน ยิงทีละคำขอเท่านั้น');
});

test('Retry-After ที่แหล่งส่งมา ถูกใช้กำหนดเวลาพัก (ไม่ใช่ค่าตั้งต้นของเราเอง)', () => {
  setLimiterTiming({ reset: true, gapMs: 1, basePauseMs: 5 });
  const ms = backoff('2');
  assert.equal(ms, 2000);
  assert.ok(pausedFor() > 1500, `คิวต้องถูกพักไว้จริง แต่ได้ ${pausedFor()}ms`);
  setLimiterTiming({ reset: true });
});
