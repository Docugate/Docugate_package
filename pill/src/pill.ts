// @docugate/pill — in-app tour pill
// No framework, no dependencies. Shadow DOM isolates styles.

// ---------------------------------------------------------------------------
// Types (mirror tour.ts shapes exactly)
// ---------------------------------------------------------------------------

interface TourStop {
  heading: string
  target: string
  data?: string
  code: string
  source?: string
  docs?: string
  prose: string
}

interface Tour {
  route: string
  title: string
  stops: TourStop[]
}

declare global {
  interface Window {
    DOCUGATE_TOUR?: Tour[]
  }
}

// ---------------------------------------------------------------------------
// Route matching (mirrors matchRoute in tour.ts)
// ---------------------------------------------------------------------------

export function matchRoute(route: string, pathname: string): boolean {
  const routeParts = route.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (routeParts.length !== pathParts.length) return false
  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) continue
    if (routeParts[i] !== pathParts[i]) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Selector suggestion
// ---------------------------------------------------------------------------

/**
 * Suggest a [data-tour="..."] selector for an element.
 * Priority: existing data-tour → id → role+text → tag+position.
 */
export function suggestSelector(el: Element): { selector: string; needsAttribute: boolean } {
  const existing = el.getAttribute('data-tour')
  if (existing) {
    return { selector: `[data-tour="${existing}"]`, needsAttribute: false }
  }

  // Derive a slug from id, aria-label, or text content
  const id = el.id
  if (id) {
    const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    return { selector: `[data-tour="${slug}"]`, needsAttribute: true }
  }

  const label = el.getAttribute('aria-label') || el.getAttribute('title')
  if (label) {
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    return { selector: `[data-tour="${slug}"]`, needsAttribute: true }
  }

  const text = (el.textContent ?? '').trim().slice(0, 30)
  if (text) {
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    return { selector: `[data-tour="${slug}"]`, needsAttribute: true }
  }

  const tag = el.tagName.toLowerCase()
  return { selector: `[data-tour="${tag}"]`, needsAttribute: true }
}

// ---------------------------------------------------------------------------
// Server URL: read from this script's own src attribute
// ---------------------------------------------------------------------------

function getServerBase(): string | null {
  const scripts = document.querySelectorAll('script[src]')
  for (const s of Array.from(scripts)) {
    const src = (s as HTMLScriptElement).src
    if (src && src.endsWith('/pill.js')) {
      const url = new URL(src)
      return `${url.protocol}//${url.host}`
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Fetch current tour from server or window.DOCUGATE_TOUR
// ---------------------------------------------------------------------------

/**
 * The current page's tour, and whether the tour server answered at all. The
 * two are different: a page with no tour yet still gets the pill, so its first
 * stop can be added from the inspector. Only a silent server hides it.
 */
async function fetchTour(base: string): Promise<{ alive: boolean; tour: Tour | null }> {
  const pathname = location.pathname
  if (window.DOCUGATE_TOUR) {
    const match = window.DOCUGATE_TOUR.find((t) => matchRoute(t.route, pathname))
    return { alive: true, tour: match ?? null }
  }
  try {
    const res = await fetch(`${base}/tour?path=${encodeURIComponent(pathname)}`, { signal: AbortSignal.timeout(3000) })
    if (res.status === 404) return { alive: true, tour: null }
    if (!res.ok) return { alive: false, tour: null }
    return { alive: true, tour: (await res.json()) as Tour }
  } catch {
    return { alive: false, tour: null }
  }
}

// ---------------------------------------------------------------------------
// CSS (injected into shadow DOM)
// ---------------------------------------------------------------------------

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

/* One material for everything the pill draws: near-black glass, a hairline
   border and a soft shadow, the way the Next.js dev indicator looks. */
.surface {
  background: rgba(12, 12, 14, 0.92);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  backdrop-filter: blur(12px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 12px 32px -8px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: #ededed;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ── the badge ── */
.pill-btn {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 9px;
  border-radius: 999px;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.15s;
}
.pill-btn.away { opacity: 0; pointer-events: none; transform: scale(0.8); }
.pill-btn.dragging { cursor: grabbing; transition: none; }
.pill-btn:hover { background: rgba(24, 24, 28, 0.96); }
.pill-btn:active:not(.dragging) { transform: scale(0.96); }
.pill-btn:focus-visible { outline: 2px solid #F4C43F; outline-offset: 3px; }
.pill-glyph { width: 18px; height: 14px; flex-shrink: 0; display: block; }
.pill-label {
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  opacity: 0;
  margin-left: 0;
  transition: max-width 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s, margin 0.28s;
}
.pill-btn:hover .pill-label, .pill-btn:focus-visible .pill-label, .pill-btn.open .pill-label {
  max-width: 220px;
  opacity: 1;
  margin-left: 8px;
}
.pill-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: #F4C43F;
  color: #10122F;
  font: 700 10.5px/17px -apple-system, "Segoe UI", system-ui, sans-serif;
  text-align: center;
  box-shadow: 0 0 0 2px rgba(12, 12, 14, 0.92);
}
.pill-btn.inspecting { box-shadow: 0 0 0 2px #F4C43F, 0 12px 32px -8px rgba(0, 0, 0, 0.55); }

/* ── the panel ── */
.menu {
  position: fixed;
  z-index: 2147483647;
  width: 288px;
  border-radius: 12px;
  overflow: hidden;
  transform-origin: var(--origin, bottom right);
  animation: pop 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes pop { from { opacity: 0; transform: scale(0.96) translateY(var(--rise, 4px)); } }
.menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.menu-route { font: 12px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace; color: #a1a1a1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu-tag { flex-shrink: 0; font-size: 11px; color: #10122F; background: #F4C43F; border-radius: 999px; padding: 1px 8px; font-weight: 600; }
.menu-tag.empty { color: #a1a1a1; background: rgba(255, 255, 255, 0.08); }
.menu-list { padding: 6px; }
.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 8px 10px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: #ededed;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.menu-item:hover, .menu-item:focus-visible { background: rgba(255, 255, 255, 0.07); outline: none; }
.menu-item:disabled { color: #6e6e6e; cursor: default; background: none; }
.menu-hint { color: #8f8f8f; font-size: 12px; }
kbd {
  font: 11px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
  color: #a1a1a1;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 0 5px;
}
.switch { position: relative; width: 28px; height: 16px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); transition: background 0.15s; flex-shrink: 0; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1); }
.menu-item[aria-checked="true"] .switch { background: #F4C43F; }
.menu-item[aria-checked="true"] .switch::after { transform: translateX(12px); background: #10122F; }
.menu-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 12px;
  color: #8f8f8f;
}
.menu-foot .live { display: inline-flex; align-items: center; gap: 6px; }
.menu-foot .live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: #45d483; box-shadow: 0 0 0 3px rgba(69, 212, 131, 0.15); }
.link-btn { border: 0; background: none; color: #a1a1a1; font: inherit; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
.link-btn:hover, .link-btn:focus-visible { color: #ededed; background: rgba(255, 255, 255, 0.07); outline: none; }

/* ── walkthrough card and inspector popup ── */
.wt-card, .insp-popup {
  position: fixed;
  z-index: 2147483645;
  border-radius: 12px;
  width: 340px;
  max-width: calc(100vw - 24px);
  padding: 16px 16px 12px;
  animation: pop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: auto;
}
.wt-eyebrow { font-size: 11px; color: #8f8f8f; margin: 0 0 4px; letter-spacing: 0.02em; }
.wt-card-heading, .insp-popup-heading { font-size: 15px; font-weight: 600; color: #fff; margin: 0 0 6px; letter-spacing: -0.01em; }
.wt-prose, .insp-popup-prose { font-size: 13px; color: #c7c7c7; margin: 0 0 12px; line-height: 1.55; }
.wt-prose code, .insp-popup-prose code { font: 12px ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace; color: #f5f0e3; background: rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 1px 5px; }
.wt-fields {
  display: grid;
  grid-template-columns: 58px 1fr;
  gap: 6px 10px;
  padding: 10px 12px;
  margin: 0 0 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.wt-field-label, .insp-popup-label { font-size: 11px; color: #8f8f8f; padding-top: 1px; }
.wt-field-value, .insp-popup-val { font: 12px/1.45 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace; color: #e4e4e4; overflow-wrap: break-word; }
.wt-field-value a, .insp-popup-val a { color: #F4C43F; text-decoration: none; }
.wt-field-value a:hover, .insp-popup-val a:hover { text-decoration: underline; }
.wt-nav, .insp-popup-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.wt-dots { display: flex; gap: 4px; margin-right: auto; }
.wt-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 255, 255, 0.18); transition: background 0.2s, width 0.2s; }
.wt-dots i.on { width: 16px; border-radius: 999px; background: #F4C43F; }
.wt-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #ededed;
  font: 500 12.5px -apple-system, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.wt-btn:hover { background: rgba(255, 255, 255, 0.09); }
.wt-btn:focus-visible { outline: 2px solid #F4C43F; outline-offset: 2px; }
.wt-btn.primary { background: #F4C43F; border-color: #F4C43F; color: #10122F; font-weight: 600; }
.wt-btn.primary:hover { background: #ffd35c; border-color: #ffd35c; }

/* ── add / edit form ── */
.add-form {
  position: fixed;
  z-index: 2147483646;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 380px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 48px);
  overflow: auto;
  border-radius: 14px;
  padding: 18px 18px 14px;
}
.add-form-title { font-size: 15px; font-weight: 600; color: #fff; margin: 0 0 12px; }
.add-form label { display: block; font-size: 11.5px; color: #a1a1a1; margin: 10px 0 4px; }
.add-form label:first-of-type { margin-top: 0; }
.add-form input, .add-form textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #ededed;
  font: 12.5px/1.4 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
  padding: 7px 9px;
  resize: vertical;
}
.add-form textarea { min-height: 64px; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
.add-form input:focus, .add-form textarea:focus { outline: none; border-color: #F4C43F; box-shadow: 0 0 0 3px rgba(244, 196, 63, 0.18); }
.add-form-warn {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #f1dc9a;
  background: rgba(244, 196, 63, 0.08);
  border: 1px solid rgba(244, 196, 63, 0.25);
  border-radius: 8px;
  padding: 8px 10px;
}
.add-form-warn code { font-family: ui-monospace, "Cascadia Mono", Menlo, monospace; color: #F4C43F; }
.add-form-actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 14px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; }
}
`

// ---------------------------------------------------------------------------
// Highlight ring drawn on a canvas over the page
// ---------------------------------------------------------------------------

function createRingCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483641;'
  c.width = window.innerWidth
  c.height = window.innerHeight
  return c
}

function drawRing(canvas: HTMLCanvasElement, rect: DOMRect): void {
  const ctx = canvas.getContext('2d')!
  const pad = 6
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // dim the rest of the page
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // cut-out for target
  const x = rect.left - pad
  const y = rect.top - pad
  const w = rect.width + pad * 2
  const h = rect.height + pad * 2
  const r = 6
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // ring
  ctx.strokeStyle = '#F4C43F'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.stroke()
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

// ---------------------------------------------------------------------------
// Card positioning: place card near target without clipping viewport
// ---------------------------------------------------------------------------

function positionCard(card: HTMLElement, rect: DOMRect): void {
  const cw = card.offsetWidth || 340
  const ch = card.offsetHeight || 220
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pad = 12

  let top = rect.bottom + 16
  let left = rect.left

  if (top + ch > vh - pad) top = rect.top - ch - 16
  if (top < pad) top = pad

  if (left + cw > vw - pad) left = vw - cw - pad
  if (left < pad) left = pad

  card.style.top = `${top}px`
  card.style.left = `${left}px`
}

// ---------------------------------------------------------------------------
// Inspector: highlight element on hover
// ---------------------------------------------------------------------------

let inspectorHighlight: HTMLElement | null = null

function createHighlightEl(): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:2147483642',
    'border:2px solid #F4C43F',
    'border-radius:4px',
    'background:rgba(244,196,63,0.10)',
    'transition:top 0.06s,left 0.06s,width 0.06s,height 0.06s',
    'display:none',
  ].join(';')
  return el
}

function moveHighlight(el: HTMLElement, rect: DOMRect): void {
  el.style.display = 'block'
  el.style.top = `${rect.top - 2}px`
  el.style.left = `${rect.left - 2}px`
  el.style.width = `${rect.width + 4}px`
  el.style.height = `${rect.height + 4}px`
}

// ---------------------------------------------------------------------------
// Text helpers for cards
// ---------------------------------------------------------------------------

/** Lets a long path wrap after its slashes rather than in the middle of a name. */
function breakable(text: string): string {
  return text.replace(/\//g, '/\u200b')
}

/** Writes prose into `el`, turning `backticked` spans into inline code. Never HTML. */
function renderProse(el: HTMLElement, prose: string): void {
  prose.split(/(`[^`]+`)/).forEach((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const code = document.createElement('code')
      code.textContent = part.slice(1, -1)
      el.appendChild(code)
    } else if (part) {
      el.appendChild(document.createTextNode(part))
    }
  })
}

// ---------------------------------------------------------------------------
// Corners: the badge can be dragged to any of the four, like the Next.js one
// ---------------------------------------------------------------------------

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
const CORNER_KEY = 'docugate-pill-corner'
const HIDDEN_KEY = 'docugate-pill-hidden'
const EDGE = 16

/** The corner nearest to a point, for snapping the badge where it is dropped. */
export function nearestCorner(x: number, y: number, width: number, height: number): Corner {
  const vertical = y < height / 2 ? 'top' : 'bottom'
  const horizontal = x < width / 2 ? 'left' : 'right'
  return `${vertical}-${horizontal}` as Corner
}

function savedCorner(): Corner {
  try {
    const value = localStorage.getItem(CORNER_KEY) as Corner | null
    return value && CORNERS.includes(value) ? value : 'bottom-right'
  } catch {
    return 'bottom-right'
  }
}

/** Pins an element to a corner, `offset` px further in from the edge. */
function pin(el: HTMLElement, corner: Corner, offset = 0): void {
  const [v, h] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  el.style.top = el.style.bottom = el.style.left = el.style.right = ''
  el.style[v] = `${EDGE + offset}px`
  el.style[h] = `${EDGE}px`
}

/** DocuGate's owl glyph, in cream and gold. */
const GLYPH = `<svg class="pill-glyph" viewBox="0 0 48 36" aria-hidden="true"><defs><mask id="dg-m" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="36"><rect width="48" height="36" fill="#fff"/><polygon points="24,19 30.5,25 24,33.5 17.5,25" fill="#000" stroke="#000" stroke-width="3.2" stroke-linejoin="round"/></mask></defs><g transform="translate(-0.9 -2.4)"><g mask="url(#dg-m)"><circle cx="12.5" cy="14" r="9.5" fill="none" stroke="#F5F0E3" stroke-width="4.2"/><circle cx="35.5" cy="14" r="9.5" fill="none" stroke="#F5F0E3" stroke-width="4.2"/><circle cx="14" cy="12.5" r="4.4" fill="#F5F0E3"/><circle cx="37" cy="12.5" r="4.4" fill="#F5F0E3"/></g><polygon points="24,19 24,33.5 17.5,25" fill="#F4C43F"/><polygon points="24,19 30.5,25 24,33.5" fill="#D99A1E"/></g></svg>`

// ---------------------------------------------------------------------------
// Main Pill class
// ---------------------------------------------------------------------------

class DocugatePill {
  private shadow: ShadowRoot
  private host: HTMLElement
  private base: string
  private tour: Tour | null = null
  private alive = false
  private menuOpen = false
  private walkthroughActive = false
  private inspectorActive = false
  private wtIndex = 0
  private wtStops: TourStop[] = []
  private canvas: HTMLCanvasElement | null = null
  private pillBtn: HTMLButtonElement | null = null
  private menuEl: HTMLElement | null = null
  private wtCard: HTMLElement | null = null
  private inspPopup: HTMLElement | null = null
  private addForm: HTMLElement | null = null
  private highlightEl: HTMLElement | null = null
  private evtSource: EventSource | null = null
  private boundHandleKey: (e: KeyboardEvent) => void
  private boundHandleMouseMove: (e: MouseEvent) => void
  private boundHandleClick: (e: MouseEvent) => void
  private isStaticMode = false
  private corner: Corner = savedCorner()

  constructor(base: string) {
    this.base = base
    this.isStaticMode = !!window.DOCUGATE_TOUR

    this.host = document.createElement('div')
    this.host.setAttribute('data-docugate-pill', '')
    this.shadow = this.host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = STYLES
    this.shadow.appendChild(style)

    this.boundHandleKey = this.handleKey.bind(this)
    this.boundHandleMouseMove = this.handleInspectorMouseMove.bind(this)
    this.boundHandleClick = this.handleInspectorClick.bind(this)

    document.body.appendChild(this.host)

    this.init()
    this.patchHistory()

    if (!this.isStaticMode) {
      this.listenEvents()
    }
  }

  private async init(): Promise<void> {
    await this.load()
    // Server didn't respond: draw nothing.
    if (!this.alive) return
    this.render()
  }

  private async load(): Promise<void> {
    const { alive, tour } = await fetchTour(this.base)
    this.alive = alive
    this.tour = tour
  }

  private render(): void {
    this.removePill()

    if (!this.alive) return
    try {
      if (sessionStorage.getItem(HIDDEN_KEY)) return
    } catch {
      // storage blocked: show the pill
    }

    const stops = this.tour?.stops.length ?? 0
    const btn = document.createElement('button')
    btn.className = `pill-btn surface${this.inspectorActive ? ' inspecting' : ''}`
    btn.setAttribute('aria-haspopup', 'menu')
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-label', `DocuGate tour: ${stops ? `${stops} stops on this page` : 'no tour on this page yet'}`)
    btn.innerHTML =
      GLYPH +
      `<span class="pill-label">${stops ? `${stops} stop${stops === 1 ? '' : 's'} on this page` : 'No tour on this page yet'}</span>` +
      (stops ? `<span class="pill-count" aria-hidden="true">${stops}</span>` : '')
    pin(btn, this.corner)
    this.makeDraggable(btn)
    this.shadow.appendChild(btn)
    this.pillBtn = btn
  }

  /**
   * Click opens the panel; a drag of a few pixels moves the badge instead and
   * drops it in the nearest corner, which is remembered for next time.
   */
  private makeDraggable(btn: HTMLButtonElement): void {
    let start: { x: number; y: number } | null = null
    let dragged = false

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      start = { x: e.clientX, y: e.clientY }
      dragged = false
      btn.setPointerCapture(e.pointerId)
    })
    btn.addEventListener('pointermove', (e) => {
      if (!start) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!dragged && Math.hypot(dx, dy) < 5) return
      if (!dragged) {
        dragged = true
        this.closeMenu()
        btn.classList.add('dragging')
      }
      btn.style.transform = `translate(${dx}px, ${dy}px)`
    })
    btn.addEventListener('pointerup', (e) => {
      if (!start) return
      start = null
      if (!dragged) return
      btn.classList.remove('dragging')
      btn.style.transform = ''
      this.corner = nearestCorner(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      try {
        localStorage.setItem(CORNER_KEY, this.corner)
      } catch {
        // not remembered, still moved
      }
      pin(btn, this.corner)
    })
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (dragged) {
        dragged = false
        return
      }
      this.toggleMenu()
    })
  }

  private removePill(): void {
    this.pillBtn?.remove()
    this.pillBtn = null
    this.closeMenu()
  }

  // ── Menu ──────────────────────────────────────────────────────────────────

  private toggleMenu(): void {
    if (this.menuOpen) {
      this.closeMenu()
    } else {
      this.openMenu()
    }
  }

  private openMenu(): void {
    this.closeMenu()
    const stops = this.tour?.stops.length ?? 0
    const menu = document.createElement('div')
    menu.className = 'menu surface'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', 'DocuGate tour')

    const head = document.createElement('div')
    head.className = 'menu-head'
    const route = document.createElement('span')
    route.className = 'menu-route'
    route.textContent = this.tour?.route ?? location.pathname
    const tag = document.createElement('span')
    tag.className = `menu-tag${stops ? '' : ' empty'}`
    tag.textContent = stops ? `${stops} stop${stops === 1 ? '' : 's'}` : 'No tour yet'
    head.append(route, tag)

    const list = document.createElement('div')
    list.className = 'menu-list'

    const item = (label: string, right: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button')
      b.className = 'menu-item'
      b.setAttribute('role', 'menuitem')
      b.disabled = disabled
      b.innerHTML = `<span></span>${right}`
      b.firstElementChild!.textContent = label
      b.addEventListener('click', () => { this.closeMenu(); onClick() })
      list.appendChild(b)
      return b
    }

    item('Walkthrough', stops ? '<kbd>&#8594;</kbd>' : '<span class="menu-hint">No stops yet</span>', () => this.startWalkthrough(), !stops)
    const insp = item('Inspector', '<span class="switch" aria-hidden="true"></span>', () => this.toggleInspector())
    insp.setAttribute('role', 'menuitemcheckbox')
    insp.setAttribute('aria-checked', String(this.inspectorActive))
    if (!this.isStaticMode) {
      item('Add to tour', '<span class="menu-hint">Click an element</span>', () => {
        if (!this.inspectorActive) this.toggleInspector()
      })
    }

    const foot = document.createElement('div')
    foot.className = 'menu-foot'
    const status = document.createElement('span')
    status.className = 'live'
    status.textContent = this.isStaticMode ? 'Static demo' : this.base.replace(/^https?:\/\//, '')
    const hide = document.createElement('button')
    hide.className = 'link-btn'
    hide.textContent = 'Hide'
    hide.title = 'Hide until this tab is reloaded'
    hide.addEventListener('click', () => {
      try {
        sessionStorage.setItem(HIDDEN_KEY, '1')
      } catch {
        // hidden for now only
      }
      if (this.inspectorActive) this.stopInspector()
      this.removePill()
    })
    foot.append(status, hide)

    menu.append(head, list, foot)

    // Open away from the corner the badge sits in.
    const [v, h] = this.corner.split('-')
    pin(menu, this.corner, 44)
    menu.style.setProperty('--origin', `${v} ${h}`)
    menu.style.setProperty('--rise', v === 'bottom' ? '6px' : '-6px')

    this.shadow.appendChild(menu)
    this.menuEl = menu
    this.menuOpen = true
    this.pillBtn?.classList.add('open')
    this.pillBtn?.setAttribute('aria-expanded', 'true')
    ;(list.querySelector('.menu-item:not(:disabled)') as HTMLElement | null)?.focus()

    const close = (e: Event) => {
      const inside = e.composedPath().some((n) => n === menu || n === this.pillBtn)
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !inside) {
        this.closeMenu()
        document.removeEventListener('click', close, true)
        document.removeEventListener('keydown', close, true)
      }
    }
    document.addEventListener('click', close, true)
    document.addEventListener('keydown', close, true)
  }

  private closeMenu(): void {
    this.menuEl?.remove()
    this.menuEl = null
    this.menuOpen = false
    this.pillBtn?.classList.remove('open')
    this.pillBtn?.setAttribute('aria-expanded', 'false')
  }

  // ── Walkthrough ───────────────────────────────────────────────────────────

  private startWalkthrough(): void {
    if (!this.tour) return
    // Filter to stops whose target exists in the DOM
    this.wtStops = this.tour.stops.filter((s) => document.querySelector(s.target) !== null)
    if (!this.wtStops.length) return

    this.walkthroughActive = true
    // The card needs the corner the badge sits in; it steps aside until Done.
    this.pillBtn?.classList.add('away')
    this.wtIndex = 0
    this.canvas = createRingCanvas()
    document.body.appendChild(this.canvas)
    document.addEventListener('keydown', this.boundHandleKey)
    window.addEventListener('resize', () => this.refreshWtCard())
    this.showWtStep()
  }

  private showWtStep(): void {
    const stop = this.wtStops[this.wtIndex]
    const target = document.querySelector(stop.target)
    if (!target) { this.nextWtStep(); return }

    const rect = target.getBoundingClientRect()
    if (this.canvas) {
      this.canvas.width = window.innerWidth
      this.canvas.height = window.innerHeight
      drawRing(this.canvas, rect)
    }
    target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

    this.wtCard?.remove()
    const card = document.createElement('div')
    card.className = 'wt-card surface'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', stop.heading)

    const eyebrow = document.createElement('p')
    eyebrow.className = 'wt-eyebrow'
    eyebrow.textContent = `${this.tour?.title ?? 'Tour'} · stop ${this.wtIndex + 1} of ${this.wtStops.length}`
    card.appendChild(eyebrow)

    const heading = document.createElement('h2')
    heading.className = 'wt-card-heading'
    heading.textContent = stop.heading
    card.appendChild(heading)

    if (stop.prose) {
      const prose = document.createElement('p')
      prose.className = 'wt-prose'
      renderProse(prose, stop.prose)
      card.appendChild(prose)
    }

    const grid = document.createElement('div')
    grid.className = 'wt-fields'

    const fields: Array<{ label: string; value: string; isLink?: boolean }> = []
    if (stop.data) fields.push({ label: 'Data', value: stop.data })
    fields.push({ label: 'Code', value: stop.code })
    if (stop.source) fields.push({ label: 'Source', value: stop.source })
    if (stop.docs) fields.push({ label: 'Docs', value: stop.docs, isLink: true })

    for (const f of fields) {
      const lbl = document.createElement('span')
      lbl.className = 'wt-field-label'
      lbl.textContent = f.label
      const val = document.createElement('span')
      val.className = 'wt-field-value'
      if (f.isLink && f.value.startsWith('http')) {
        const a = document.createElement('a')
        a.href = f.value
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = breakable(f.value)
        val.appendChild(a)
      } else {
        val.textContent = breakable(f.value)
      }
      grid.append(lbl, val)
    }
    card.appendChild(grid)

    const nav = document.createElement('div')
    nav.className = 'wt-nav'

    const dots = document.createElement('span')
    dots.className = 'wt-dots'
    dots.setAttribute('aria-hidden', 'true')
    dots.innerHTML = this.wtStops.map((_, i) => `<i class="${i === this.wtIndex ? 'on' : ''}"></i>`).join('')
    nav.appendChild(dots)

    if (this.wtIndex > 0) {
      const back = document.createElement('button')
      back.className = 'wt-btn'
      back.textContent = 'Back'
      back.addEventListener('click', () => this.prevWtStep())
      nav.appendChild(back)
    }

    const isLast = this.wtIndex === this.wtStops.length - 1
    const next = document.createElement('button')
    next.className = 'wt-btn primary'
    next.textContent = isLast ? 'Done' : 'Next'
    next.addEventListener('click', () => isLast ? this.stopWalkthrough() : this.nextWtStep())
    nav.appendChild(next)

    card.appendChild(nav)
    this.shadow.appendChild(card)
    this.wtCard = card
    next.focus()

    // Position after appending (needs offsetHeight)
    requestAnimationFrame(() => positionCard(card, rect))
  }

  private refreshWtCard(): void {
    if (!this.walkthroughActive) return
    const stop = this.wtStops[this.wtIndex]
    const target = document.querySelector(stop.target)
    if (!target) return
    const rect = target.getBoundingClientRect()
    if (this.canvas) {
      this.canvas.width = window.innerWidth
      this.canvas.height = window.innerHeight
      drawRing(this.canvas, rect)
    }
    if (this.wtCard) positionCard(this.wtCard, rect)
  }

  private nextWtStep(): void {
    this.wtIndex++
    if (this.wtIndex >= this.wtStops.length) {
      this.stopWalkthrough()
      return
    }
    this.showWtStep()
  }

  private prevWtStep(): void {
    if (this.wtIndex > 0) {
      this.wtIndex--
      this.showWtStep()
    }
  }

  private stopWalkthrough(): void {
    this.walkthroughActive = false
    this.pillBtn?.classList.remove('away')
    this.wtCard?.remove()
    this.wtCard = null
    if (this.canvas) {
      clearCanvas(this.canvas)
      this.canvas.remove()
      this.canvas = null
    }
    document.removeEventListener('keydown', this.boundHandleKey)
  }

  // ── Inspector ─────────────────────────────────────────────────────────────

  private toggleInspector(): void {
    if (this.inspectorActive) {
      this.stopInspector()
    } else {
      this.startInspector()
    }
  }

  private startInspector(): void {
    this.inspectorActive = true
    this.pillBtn?.classList.add('inspecting')
    this.highlightEl = createHighlightEl()
    document.body.appendChild(this.highlightEl)
    document.addEventListener('mousemove', this.boundHandleMouseMove, true)
    document.addEventListener('click', this.boundHandleClick, true)
    document.addEventListener('keydown', this.boundHandleKey)
  }

  private stopInspector(): void {
    this.inspectorActive = false
    this.pillBtn?.classList.remove('inspecting')
    document.removeEventListener('mousemove', this.boundHandleMouseMove, true)
    document.removeEventListener('click', this.boundHandleClick, true)
    document.removeEventListener('keydown', this.boundHandleKey)
    if (this.highlightEl) {
      this.highlightEl.remove()
      this.highlightEl = null
    }
    inspectorHighlight = null
    this.closeInspPopup()
    this.closeAddForm()
  }

  private handleInspectorMouseMove(e: MouseEvent): void {
    if (!this.inspectorActive) return
    const el = e.target as Element
    if (el && !this.host.contains(el)) {
      const rect = el.getBoundingClientRect()
      if (this.highlightEl) moveHighlight(this.highlightEl, rect)
      inspectorHighlight = el as HTMLElement
    }
  }

  private handleInspectorClick(e: MouseEvent): void {
    if (!this.inspectorActive) return
    const el = e.target as Element
    if (!el || this.host.contains(el)) return
    e.preventDefault()
    e.stopPropagation()

    const stop = this.findStopForElement(el)
    if (stop) {
      this.showInspPopup(el as HTMLElement, stop)
    } else {
      this.showAddForm(el as HTMLElement)
    }
  }

  private findStopForElement(el: Element): TourStop | null {
    if (!this.tour) return null
    for (const stop of this.tour.stops) {
      try {
        if (el.matches(stop.target)) return stop
      } catch {
        // invalid selector — skip
      }
    }
    return null
  }

  private showInspPopup(el: HTMLElement, stop: TourStop): void {
    this.closeInspPopup()
    const popup = document.createElement('div')
    popup.className = 'insp-popup surface'
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', stop.heading)

    const heading = document.createElement('h3')
    heading.className = 'insp-popup-heading'
    heading.textContent = stop.heading
    popup.appendChild(heading)

    if (stop.prose) {
      const prose = document.createElement('p')
      prose.className = 'insp-popup-prose'
      renderProse(prose, stop.prose)
      popup.appendChild(prose)
    }

    const grid = document.createElement('div')
    grid.className = 'wt-fields'

    const rows: Array<{ label: string; value: string; isLink?: boolean }> = []
    if (stop.data) rows.push({ label: 'Data', value: stop.data })
    rows.push({ label: 'Code', value: stop.code })
    if (stop.source) rows.push({ label: 'Source', value: stop.source })
    if (stop.docs) rows.push({ label: 'Docs', value: stop.docs, isLink: true })

    for (const r of rows) {
      const lbl = document.createElement('span')
      lbl.className = 'insp-popup-label'
      lbl.textContent = r.label
      const val = document.createElement('span')
      val.className = 'insp-popup-val'
      if (r.isLink && r.value.startsWith('http')) {
        const a = document.createElement('a')
        a.href = r.value
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = breakable(r.value)
        val.appendChild(a)
      } else {
        val.textContent = breakable(r.value)
      }
      grid.append(lbl, val)
    }
    popup.appendChild(grid)

    if (!this.isStaticMode) {
      const actions = document.createElement('div')
      actions.className = 'insp-popup-actions'

      const editBtn = document.createElement('button')
      editBtn.className = 'wt-btn'
      editBtn.textContent = 'Edit'
      editBtn.addEventListener('click', () => {
        this.closeInspPopup()
        this.showAddForm(el, stop)
      })
      actions.appendChild(editBtn)

      const closeBtn = document.createElement('button')
      closeBtn.className = 'wt-btn primary'
      closeBtn.textContent = 'Close'
      closeBtn.addEventListener('click', () => this.closeInspPopup())
      actions.appendChild(closeBtn)
      popup.appendChild(actions)
    } else {
      const closeBtn = document.createElement('button')
      closeBtn.className = 'wt-btn primary'
      closeBtn.textContent = 'Close'
      closeBtn.addEventListener('click', () => this.closeInspPopup())
      const actions = document.createElement('div')
      actions.className = 'insp-popup-actions'
      actions.appendChild(closeBtn)
      popup.appendChild(actions)
    }

    // Position near element
    const rect = el.getBoundingClientRect()
    popup.style.top = `${Math.min(rect.bottom + 10, window.innerHeight - 200)}px`
    popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 352))}px`

    this.shadow.appendChild(popup)
    this.inspPopup = popup
  }

  private closeInspPopup(): void {
    this.inspPopup?.remove()
    this.inspPopup = null
  }

  // ── Add/Edit form ─────────────────────────────────────────────────────────

  private showAddForm(el: HTMLElement, existing?: TourStop): void {
    this.closeAddForm()
    const { selector, needsAttribute } = suggestSelector(el)

    const form = document.createElement('div')
    form.className = 'add-form surface'
    form.setAttribute('role', 'dialog')
    form.setAttribute('aria-modal', 'true')
    form.setAttribute('aria-label', existing ? 'Edit stop' : 'Add stop')

    const title = document.createElement('h3')
    title.className = 'add-form-title'
    title.textContent = existing ? 'Edit stop' : 'Add to tour'
    form.appendChild(title)

    const fields: Array<{ id: string; label: string; value: string; multi?: boolean }> = [
      { id: 'f-heading', label: 'Heading', value: existing?.heading ?? '' },
      { id: 'f-target', label: 'Target (selector)', value: existing?.target ?? selector },
      { id: 'f-data', label: 'Data (optional)', value: existing?.data ?? '' },
      { id: 'f-code', label: 'Code file', value: existing?.code ?? '' },
      { id: 'f-source', label: 'Source file (optional)', value: existing?.source ?? '' },
      { id: 'f-docs', label: 'Docs URL (optional)', value: existing?.docs ?? '' },
      { id: 'f-prose', label: 'Prose', value: existing?.prose ?? '', multi: true },
    ]

    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {}

    for (const f of fields) {
      const lbl = document.createElement('label')
      lbl.setAttribute('for', f.id)
      lbl.textContent = f.label
      form.appendChild(lbl)

      const input = f.multi
        ? document.createElement('textarea')
        : document.createElement('input')
      input.id = f.id
      input.value = f.value
      if (!f.multi) (input as HTMLInputElement).type = 'text'
      form.appendChild(input)
      inputs[f.id] = input
    }

    if (needsAttribute && !existing) {
      const warn = document.createElement('div')
      warn.className = 'add-form-warn'
      warn.innerHTML = `This element has no <code>data-tour</code> attribute yet. Add this attribute to identify it:<br><code>data-tour="${selector.replace(/^\[data-tour="/, '').replace(/"\]$/, '')}"</code>`
      form.appendChild(warn)
    }

    const actions = document.createElement('div')
    actions.className = 'add-form-actions'

    const cancel = document.createElement('button')
    cancel.className = 'wt-btn'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => this.closeAddForm())
    actions.appendChild(cancel)

    const save = document.createElement('button')
    save.className = 'wt-btn primary'
    save.textContent = 'Save'
    save.addEventListener('click', () => {
      const stop: TourStop = {
        heading: (inputs['f-heading'] as HTMLInputElement).value.trim(),
        target: (inputs['f-target'] as HTMLInputElement).value.trim(),
        data: (inputs['f-data'] as HTMLInputElement).value.trim() || undefined,
        code: (inputs['f-code'] as HTMLInputElement).value.trim(),
        source: (inputs['f-source'] as HTMLInputElement).value.trim() || undefined,
        docs: (inputs['f-docs'] as HTMLInputElement).value.trim() || undefined,
        prose: (inputs['f-prose'] as HTMLTextAreaElement).value.trim(),
      }
      if (!stop.heading || !stop.target || !stop.code) return
      this.saveStop(stop)
      this.closeAddForm()
    })
    actions.appendChild(save)
    form.appendChild(actions)

    this.shadow.appendChild(form)
    this.addForm = form
    ;(inputs['f-heading'] as HTMLInputElement).focus()
  }

  private closeAddForm(): void {
    this.addForm?.remove()
    this.addForm = null
  }

  private async saveStop(stop: TourStop): Promise<void> {
    // A page with no tour yet starts one at its own path.
    const route = this.tour?.route ?? location.pathname
    try {
      await fetch(`${this.base}/stop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, stop }),
      })
    } catch {
      // best-effort
    }
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  private handleKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (this.addForm) { this.closeAddForm(); return }
      if (this.inspPopup) { this.closeInspPopup(); return }
      if (this.walkthroughActive) { this.stopWalkthrough(); return }
      if (this.inspectorActive) { this.stopInspector(); return }
    }
    if (this.walkthroughActive) {
      if (e.key === 'ArrowRight') this.nextWtStep()
      if (e.key === 'ArrowLeft') this.prevWtStep()
    }
  }

  // ── SSE events ────────────────────────────────────────────────────────────

  private listenEvents(): void {
    try {
      const es = new EventSource(`${this.base}/events`)
      es.addEventListener('message', (e) => {
        if (e.data === 'change') this.reload()
      })
      es.addEventListener('error', () => {
        es.close()
      })
      this.evtSource = es
    } catch {
      // SSE not available
    }
  }

  private async reload(): Promise<void> {
    await this.load()
    if (this.walkthroughActive) this.stopWalkthrough()
    if (this.inspectorActive) this.stopInspector()
    this.render()
  }

  // ── URL change detection ──────────────────────────────────────────────────

  private patchHistory(): void {
    const onNavigate = () => { setTimeout(() => this.reload(), 50) }

    const origPush = history.pushState.bind(history)
    history.pushState = (...args) => {
      origPush(...args)
      onNavigate()
    }

    const origReplace = history.replaceState.bind(history)
    history.replaceState = (...args) => {
      origReplace(...args)
      onNavigate()
    }

    window.addEventListener('popstate', onNavigate)
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function boot(): void {
  if (document.querySelector('[data-docugate-pill]')) return // already mounted

  const base = window.DOCUGATE_TOUR ? '' : (getServerBase() ?? '')

  if (!window.DOCUGATE_TOUR && !base) return // no server src and no static tour

  new DocugatePill(base)
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
}
