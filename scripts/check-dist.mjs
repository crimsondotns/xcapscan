/**
 * ด่านหลัง build — ต้องไม่มีความลับหลุดเข้า dist/
 * หน้าเว็บเป็น static ทุกไบต์ใน dist/ ถือว่าสาธารณะ: กุญแจ/โทเคน/URL ของแหล่งข้อมูลจริงต้องไม่อยู่ในนี้
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
if (!existsSync(DIST)) {
  console.error(`${DIST} not found — run the build first`);
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|json|map)$/.test(p)) files.push(p);
  }
})(DIST);

/** ลายของความลับที่พบบ่อย — ตรวจแบบหยาบแต่ดักของจริงได้ */
const PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API key (sk-…)'],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'Supabase secret key'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  // ชื่อตัวแปรที่แปลว่ามีคนยัดความลับเข้า build
  [/VITE_[A-Z0-9_]*(SECRET|TOKEN|PRIVATE|APIKEY|API_KEY|KEY)\b/, 'VITE_* secret variable'],
  [/\b(api[_-]?secret|client[_-]?secret)["'\s:=]+[A-Za-z0-9_-]{12,}/i, 'secret literal'],
];

/**
 * เสิร์ฟจาก GitHub Pages ใต้ /<repo>/ — asset ทุกตัวต้องขึ้นต้นด้วย base เดียวกับที่ตั้งใน vite.config.ts
 * และหน้า 404.html (ตัวเด้ง path กลับให้แอป) ต้องรู้จัก base เดียวกัน ไม่งั้นลิงก์ที่แชร์ไปจะพาไปหน้าเปล่า
 */
function baseChecks() {
  const out = [];
  const base = /base:\s*'([^']+)'/.exec(readFileSync('vite.config.ts', 'utf8'))?.[1];
  if (!base) return ['vite.config.ts: no base found'];
  const index = readFileSync(join(DIST, 'index.html'), 'utf8');
  for (const m of index.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
    if (!m[1].startsWith(base)) out.push(`dist/index.html: asset ${m[1]} is outside the base ${base}`);
  }
  if (existsSync(join(DIST, '404.html')) && !readFileSync(join(DIST, '404.html'), 'utf8').includes(base)) {
    out.push(`dist/404.html: does not carry the base ${base}`);
  }
  // เตือน (ไม่ล้ม): บน GitHub Pages base ต้องเท่ากับ /<ชื่อ repo>/ ไม่งั้น asset 404 ตอน deploy
  const repo = /([^/]+?)(?:\.git)?\s*$/.exec(process.env.GITHUB_REPOSITORY ?? '')?.[1];
  if (repo && base !== `/${repo}/`) console.warn(`warning: base ${base} does not match the repository name /${repo}/ — GitHub Pages will 404 unless a custom domain is used`);
  return out;
}

const bad = [...baseChecks()];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const [re, what] of PATTERNS) {
    const m = re.exec(src);
    // ไม่พิมพ์ค่าที่เจอออกมา (ไม่ทำให้ความลับไปโผล่ใน log ของ CI) — บอกแค่ไฟล์กับชนิด
    if (m) bad.push(`${f}: looks like a ${what}`);
  }
}
/**
 * ตั้งใจฝังค่าที่หน้าตาเหมือนกุญแจ (ผ่าน VITE_* ตอน build) → ตั้ง ALLOW_EMBEDDED_KEYS=1 ให้เตือนแทนล้ม
 * ย้ำว่านี่ไม่ได้ทำให้มันเป็นความลับ — ทุกไบต์ใน dist/ สาธารณะ
 */
if (bad.length && process.env.ALLOW_EMBEDDED_KEYS === '1') {
  console.warn(`${bad.join('\n')}\nALLOW_EMBEDDED_KEYS=1 — ปล่อยผ่าน แต่ค่าเหล่านี้เป็นสาธารณะเมื่อ deploy`);
} else if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`dist clean (${files.length} files)`);
