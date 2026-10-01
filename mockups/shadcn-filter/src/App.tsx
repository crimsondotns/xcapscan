import * as React from "react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { blank, type Filters, type Row } from "@/tx/data"
import { DetailSheet } from "@/tx/parts"
import { VARIANTS, type VariantKey } from "@/tx/variants"

type Theme = "system" | "light" | "dark"
type Device = "mobile" | "tablet" | "desktop"
const DEVICES: Record<Device, { w: number; h: number; label: string }> = {
  mobile: { w: 390, h: 844, label: "Mobile · 390px · controls 48px" },
  tablet: { w: 820, h: 1000, label: "Tablet · 820px · controls 40px" },
  desktop: { w: 1280, h: 860, label: "Desktop · 1280px · controls 40px" },
}
const params = new URLSearchParams(location.search)

function useTheme(theme: Theme) {
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches))
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [theme])
}
const read = <T extends string>(k: string, fallback: T): T => {
  try {
    return (localStorage.getItem("txf." + k) as T) || fallback
  } catch {
    return fallback
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem("txf." + k, v)
  } catch {
    /* storage unavailable */
  }
}

/* ---------- the mockup page itself (runs inside the device iframe) ---------- */
function Frame() {
  const [variant, setVariant] = React.useState<VariantKey>((params.get("v") as VariantKey) || "popover")
  const [theme, setTheme] = React.useState<Theme>((params.get("t") as Theme) || "system")
  const [f, setF] = React.useState<Filters>({ ...blank(), hideFlagged: true, datePreset: "30d" })
  const [loading, setLoading] = React.useState(false)
  const [row, setRow] = React.useState<Row | null>(null)
  useTheme(theme)
  React.useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.v) setVariant(e.data.v)
      if (e.data?.t) setTheme(e.data.t)
    }
    window.addEventListener("message", on)
    return () => window.removeEventListener("message", on)
  }, [])
  const V = VARIANTS[variant].C
  return (
    <>
      <V
        key={variant}
        f={f}
        setF={setF}
        loading={loading}
        onReload={() => {
          setLoading(true)
          setTimeout(() => setLoading(false), 900)
        }}
        onOpen={setRow}
      />
      <DetailSheet row={row} onClose={() => setRow(null)} />
    </>
  )
}

/* ---------- presentation shell: variant · device · theme ---------- */
function Showcase() {
  const [variant, setVariant] = React.useState<VariantKey>(read("v", "popover"))
  const [device, setDevice] = React.useState<Device>(read("d", "desktop"))
  const [theme, setTheme] = React.useState<Theme>(read("t", "system"))
  const iframe = React.useRef<HTMLIFrameElement>(null)
  const stage = React.useRef<HTMLDivElement>(null)
  const [scale, setScale] = React.useState(1)
  const [src] = React.useState(() => `?frame=1&v=${variant}&t=${theme}`)
  useTheme(theme)
  React.useEffect(() => {
    iframe.current?.contentWindow?.postMessage({ v: variant, t: theme }, "*")
    write("v", variant)
    write("t", theme)
    write("d", device)
  }, [variant, theme, device])
  React.useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / DEVICES[device].w)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [device])
  const dev = DEVICES[device]

  return (
    <div className="min-h-svh bg-muted px-4 py-5">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="mr-auto text-xl font-semibold">TxTable · Advanced filter</h1>
          <ToggleGroup variant="outline" value={[device]} onValueChange={(v: string[]) => v[0] && setDevice(v[0] as Device)} aria-label="Device">
            <ToggleGroupItem value="mobile">Mobile</ToggleGroupItem>
            <ToggleGroupItem value="tablet">Tablet</ToggleGroupItem>
            <ToggleGroupItem value="desktop">Desktop</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup variant="outline" value={[theme]} onValueChange={(v: string[]) => v[0] && setTheme(v[0] as Theme)} aria-label="Theme">
            <ToggleGroupItem value="system">System</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <Tabs value={variant} onValueChange={(v) => setVariant(v as VariantKey)}>
          <TabsList className="h-auto flex-wrap">
            {(Object.keys(VARIANTS) as VariantKey[]).map((k) => (
              <TabsTrigger key={k} value={k}>{VARIANTS[k].name}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-muted-foreground">{VARIANTS[variant].note}</p>
        <div ref={stage} className="w-full" style={{ height: dev.h * scale }}>
          <div className="mx-auto origin-top-left" style={{ width: dev.w, height: dev.h, transform: `scale(${scale})`, marginLeft: scale < 1 ? 0 : undefined }}>
            <iframe
              ref={iframe}
              title="Mockup"
              src={src}
              onLoad={() => iframe.current?.contentWindow?.postMessage({ v: variant, t: theme }, "*")}
              className="size-full rounded-2xl bg-background ring-1 ring-border"
              style={{ borderRadius: device === "mobile" ? 28 : 16 }}
            />
          </div>
        </div>
        <p className="text-center text-[0.8125rem] text-muted-foreground">{dev.label}</p>
      </div>
    </div>
  )
}

export function App() {
  return params.has("frame") ? <Frame /> : <Showcase />
}
export default App
