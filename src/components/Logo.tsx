/**
 * โลโก้โทเคน/เชน — โหลดจาก URL ที่แหล่งข้อมูลให้มา ถ้าไม่มีหรือโหลดไม่ได้
 * ใช้วงกลมตัวอักษรแรกแทน (สีกลางตามธีม ไม่มีสีตกแต่ง)
 *
 * IPFS gateway list อ่านจาก VITE_IPFS_GATEWAYS (คั่นด้วย ,) — inject ตอน build
 * ถ้าไม่ตั้ง จะใช้แค่ URL ที่แหล่งข้อมูลให้มาตรงๆ
 */
import { useState } from 'react';

const env = (import.meta as unknown as { env?: { VITE_IPFS_GATEWAYS?: string } }).env;

/** gateway ที่รองรับ cross-origin hot-link — มาจาก env ตอน build */
const IPFS_GATEWAYS: string[] = (env?.VITE_IPFS_GATEWAYS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** สลับไป gateway ถัดไปสำหรับ URL แบบ ipfs://<hash> หรือ https://<gateway>/ipfs/<hash> */
export function ipfsAlternatives(src: string): string[] {
  if (!IPFS_GATEWAYS.length) return [];
  let hash: string | null = null;
  if (src.startsWith('ipfs://')) hash = src.slice(7);
  else {
    const m = /\/ipfs\/([^/?#]+)/.exec(src);
    if (m) hash = m[1] ?? null;
  }
  if (!hash) return [];
  return IPFS_GATEWAYS.map((g) => `${g}${hash}`);
}

export function Logo({ src, name, size = 20 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const [idx, setIdx] = useState(0);
  const letter = (name.trim()[0] ?? '?').toUpperCase();

  if (src && !broken) {
    const candidates = ipfsAlternatives(src);
    const url = candidates.length > 0 ? (candidates[idx] ?? candidates[0]!) : src;

    return (
      <img
        className="logo"
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => {
          if (candidates.length > 0 && idx + 1 < candidates.length) setIdx(idx + 1);
          else setBroken(true);
        }}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="logo logo-fallback" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
      {letter}
    </span>
  );
}

/** โทเคนซ้อนบนเชน (มุมขวาล่าง) */
export function TokenLogo({ token, tokenName, chain, chainName, size = 28 }: { token: string | null; tokenName: string; chain: string | null; chainName: string; size?: number }) {
  return (
    <span className="logo-stack" style={{ width: size, height: size }}>
      <Logo src={token} name={tokenName} size={size} />
      <span className="logo-badge">
        <Logo src={chain} name={chainName} size={Math.round(size * 0.57)} />
      </span>
    </span>
  );
}