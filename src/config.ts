/**
 * ค่าตั้งต้นที่ฝังตอน build — ใส่ผ่าน GitHub Actions (secret/variable) เพื่อไม่ต้องเก็บ URL ไว้ใน git
 *
 * ⚠️ เว็บนี้เป็น static: ทุกค่าที่ส่งเข้าขั้นตอน build จะอยู่ในไฟล์ JS ที่ทุกคนเปิดอ่านได้
 *    การเก็บใน GitHub Secrets ช่วยแค่ "ไม่อยู่ในซอร์ส" ไม่ได้แปลว่าเป็นความลับหลัง deploy
 *    ถ้าแหล่งไหนต้องใช้กุญแจจริงๆ กุญแจนั้นจะเป็นสาธารณะทันที — อย่าใส่กุญแจที่เสียหายได้ถ้าหลุด
 *
 * ค่าที่รองรับ (ทั้งหมดไม่บังคับ):
 *   VITE_SOURCES         JSON: [{ "name": "...", "url": "...{address}...", "family": "erc20"|"sol",
 *                                 "authHeader": "...", "apiKey": "...", "metaUrl": "..." }]
 *   VITE_CHAIN_LIST_URL  URL รายชื่อเชน
 *   VITE_CHAINS          JSON: [{ "id": "eth", "name": "Ethereum", "logo": "https://…", "explorer": "https://…" }]
 *   VITE_RPC_LIST_URL    URL รายการ RPC สาธารณะ (ยอดคงเหลือ EVM ผ่าน Multicall3)
 */
import type { ChainOverride, Endpoint, Family } from './store';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function parseJson(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // ค่าที่ตั้งไว้ผิดรูป → ทำเหมือนไม่ได้ตั้ง ดีกว่าทำให้แอปพังทั้งหน้า
    return null;
  }
}

/**
 * ลายนิ้วมือของค่าที่ฝังตอน build — เก็บไว้ในเครื่องพร้อมข้อมูล
 * ค่าที่ deploy เปลี่ยน (แก้ secret แล้ว build ใหม่) ลายนิ้วมือจะไม่ตรง เบราว์เซอร์ที่เคยเปิดไว้แล้วจึงรับค่าใหม่ได้
 * ไม่ใช่เพื่อความปลอดภัย แค่ต้องการตัวเทียบสั้นๆ ที่ไม่ต้องเก็บค่าเดิมทั้งก้อน
 */
export function configFingerprint(raw: Array<string | undefined> = [env.VITE_SOURCES, env.VITE_CHAIN_LIST_URL, env.VITE_CHAINS]): string {
  const text = raw.map((v) => v ?? '').join('\u0000');
  if (!text) return '';
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** แหล่งข้อมูลตั้งต้น — ใช้เฉพาะตอนเบราว์เซอร์นี้ยังไม่เคยมีข้อมูล ผู้ใช้แก้/ลบทับได้ตลอด */
export function configuredEndpoints(raw = env.VITE_SOURCES): Endpoint[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, i) => {
    if (!isObj(item)) return [];
    const url = str(item.url);
    if (!url) return [];
    // รับคำเก่า "evm" ได้ด้วย เพื่อไม่ให้ค่าที่ตั้งไว้แล้วพัง
    const family: Family = item.family === 'sol' ? 'sol' : 'erc20';
    return [
      {
        id: `cfg${i}`,
        name: str(item.name) ?? `source ${i + 1}`,
        url,
        family,
        enabled: item.enabled !== false,
        ...(str(item.authHeader) ? { authHeader: str(item.authHeader)! } : {}),
        ...(str(item.apiKey) ? { apiKey: str(item.apiKey)! } : {}),
        ...(str(item.metaUrl) ? { metaUrl: str(item.metaUrl)! } : {}),
      },
    ];
  });
}

export function configuredChainListUrl(raw = env.VITE_CHAIN_LIST_URL): string {
  return str(raw) ?? '';
}

/** เชนตั้งต้น (โลโก้/explorer) — ของที่ผู้ใช้ตั้งเองทับค่าเหล่านี้เสมอ */
export function configuredChains(raw = env.VITE_CHAINS): ChainOverride[] {
  const list = parseJson(raw);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!isObj(item)) return [];
    const id = str(item.id);
    if (!id) return [];
    return [
      {
        id: id.toLowerCase(),
        ...(str(item.name) ? { name: str(item.name)! } : {}),
        ...(str(item.logo) ? { logo: str(item.logo)! } : {}),
        ...(str(item.explorer) ? { explorer: str(item.explorer)! } : {}),
      },
    ];
  });
}

/** ของผู้ใช้ชนะเสมอ ที่เหลือเติมจากค่าตั้งต้น */
export function withConfiguredChains(user: ChainOverride[], fromConfig = configuredChains()): ChainOverride[] {
  const have = new Set(user.map((c) => c.id.toLowerCase()));
  return [...user, ...fromConfig.filter((c) => !have.has(c.id.toLowerCase()))];
}

/** URL รายการ RPC สาธารณะ (JSON: [{ chainId, rpc: [url | { url }] }]) — ใช้ดึงยอดคงเหลือ EVM แทนแหล่งเดิม (rpc.ts) */
export function configuredRpcListUrl(raw = env.VITE_RPC_LIST_URL): string {
  return str(raw) ?? '';
}
