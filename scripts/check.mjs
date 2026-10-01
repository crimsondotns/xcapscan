/**
 * ด่านของ repo — รันก่อน build ใน CI
 * 1. ไม่มี URL ของแหล่งข้อมูลจริงฝังในซอร์ส (ผู้ใช้ต้องใส่เองตอนใช้งาน)
 * 2. ไม่มีข้อความไทยตรงใน .tsx (ทุกข้อความผ่าน t())
 * 3. CSS: ไม่มี font-size เป็น px ลอย, ไม่มี gradient, ไม่มี uppercase, สีดิบอยู่ได้เฉพาะ tokens.css
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})('src');

const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // URL จริง (https://host) นอกจากฟอนต์/ตัวอย่างใน i18n — ไม่ให้ endpoint ใดๆ หลุดเข้าซอร์ส
  for (const m of code.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    // accounts.google.com = สคริปต์ปุ่มล็อกอินของผู้ให้บริการตัวตน ไม่ใช่แหล่งข้อมูลธุรกรรม จึงยกเว้นให้
    if (!/fonts\.g|w3\.org|example\.invalid|accounts\.google\.com/.test(m[0])) bad.push(`${f}: hardcoded URL ${m[0]}`);
  }
  if (f.endsWith('.tsx') && /type=["']number["']/.test(code)) bad.push(`${f}: type="number" (use type="text" inputMode="numeric")`);
  if (f.endsWith('.tsx') && /<select\b/.test(code)) bad.push(`${f}: native <select> (use components/Dropdown)`);
  if (f.endsWith('.tsx') && !f.endsWith('i18n.tsx')) {
    const jsx = code.replace(/\{[^{}]*\}/g, '');
    if (/[฀-๿]/.test(jsx)) bad.push(`${f}: Thai text outside t()`);
  }
  if (f.endsWith('.css')) {
    if (/font-size:\s*\d+px/.test(code)) bad.push(`${f}: px font-size`);
    if (/gradient\(/.test(code)) bad.push(`${f}: gradient`);
    if (/text-transform:\s*uppercase/.test(code)) bad.push(`${f}: uppercase (design system uses sentence case)`);
    if (/#[0-9a-f]{3,8}\b/i.test(code) && !f.endsWith('tokens.css')) bad.push(`${f}: raw colour outside tokens.css`);
  }
}
// โทเคนที่ถูกอ้างต้องมีจริงใน tokens.css — var(--x) ที่ไม่มีและไม่มีค่าสำรอง ทำให้ทั้งบรรทัดไม่มีผลแบบเงียบๆ
{
  const tokensFile = readFileSync('src/styles/tokens.css', 'utf8');
  const defined = new Set([...tokensFile.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  for (const f of files.filter((x) => x.endsWith('.css'))) {
    const src = readFileSync(f, 'utf8');
    for (const [, name] of src.matchAll(/var\((--[a-z0-9-]+)\s*\)/gi)) {
      if (!defined.has(name) && !src.includes(`${name}:`)) bad.push(`${f}: var(${name}) is not defined in tokens.css`);
    }
  }
}

// ฟอนต์: @font-face และ preload ต้องชี้ใต้ base เดียวกับ vite ไม่งั้นโหลดไม่ขึ้นและตกไปใช้ฟอนต์ระบบเงียบๆ
{
  const base = /base:\s*'([^']+)'/.exec(readFileSync('vite.config.ts', 'utf8'))?.[1] ?? '/';
  for (const f of ['src/styles/fonts.css', 'index.html']) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/["'(](\/[^"')]*assets\/fonts\/[^"')]+)/g)) {
      if (!m[1].startsWith(base)) bad.push(`${f}: font path ${m[1]} is outside the vite base ${base}`);
    }
  }
}

if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`check ok (${files.length} files)`);
