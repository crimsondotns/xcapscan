import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/*
 * เสิร์ฟจาก GitHub Pages ใต้ /<repo>/ — base ต้องตรงกับชื่อ repo ไม่งั้น asset 404
 * รัน dev/preview ใช้ base เดียวกัน จะได้เห็นพาธเดียวกับตอน deploy
 * ตัวอ่านสเปรดชีตแยกเป็น chunk เองจาก dynamic import ใน importWallets.ts
 */
/*
 * dev เท่านั้น: /__proxy?url=<https URL> ส่งต่อคำขอจากเซิร์ฟเวอร์ (ไม่มี CORS) แล้วตอบกลับพร้อม header ให้ localhost ใช้แหล่งข้อมูลที่ไม่เปิด CORS ได้
 * header จากเบราว์เซอร์ส่งต่อทั้งหมดยกเว้นของ origin (host/origin/referer/cookie) — API key ที่ผู้ใช้ตั้งจึงไปถึงปลายทาง
 * production ไม่มีส่วนนี้ (static host) → ผู้ใช้ตั้ง Proxy URL ของตัวเองใน Settings
 */
function devProxy(): Plugin {
  return {
    name: 'xcap-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://localhost');
        // /xcapscan (ไม่มี / ท้าย) → /xcapscan/ — เหมือนที่ static host ทำ
        if (u.pathname === '/xcapscan') {
          res.statusCode = 302;
          res.setHeader('location', `/xcapscan/${u.search}`);
          return res.end();
        }
        if (!u.pathname.endsWith('/__proxy')) return next();
        const target = u.searchParams.get('url') ?? '';
        if (!/^https:\/\//i.test(target)) {
          res.statusCode = 400;
          return res.end('bad url');
        }
        const drop = new Set(['host', 'origin', 'referer', 'cookie', 'connection', 'content-length']);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (!drop.has(k) && typeof v === 'string') headers[k] = v;
        try {
          const r = await fetch(target, { headers, method: 'GET' });
          res.statusCode = r.status;
          res.setHeader('content-type', r.headers.get('content-type') ?? 'application/json');
          res.setHeader('cache-control', 'no-store');
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch {
          res.statusCode = 502;
          res.end('proxy failed');
        }
      });
    },
  };
}

export default defineConfig({
  base: '/xcapscan/',
  plugins: [react(), tailwindcss(), devProxy()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5174, strictPort: true },
});
