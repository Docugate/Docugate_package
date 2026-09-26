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
  /** The tour file this screen lives in, as the server reports it. */
  file?: string
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
.menu-item { padding: 9px 10px; }
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
.insp-popup { width: 360px; }
.panel-section { margin: 4px 0 6px; font-size: 11px; color: #8f8f8f; letter-spacing: 0.02em; }
.panel-hint { margin: 0 0 12px; font-size: 12.5px; color: #a1a1a1; }
.panel-file { margin-right: auto; font: 11px ui-monospace, "Cascadia Mono", Menlo, monospace; color: #6e6e6e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.panel-error { margin: 10px 0 0; font-size: 12px; color: #ff9b8a; }
.file-link { all: unset; cursor: pointer; font: inherit; color: #ededed; border-bottom: 1px dashed rgba(244, 196, 63, 0.55); overflow-wrap: anywhere; }
.file-link:hover, .file-link:focus-visible { color: #F4C43F; border-bottom-style: solid; }
.panel-form label { display: block; font-size: 11.5px; color: #a1a1a1; margin: 10px 0 4px; }
.panel-form label:first-of-type { margin-top: 0; }
.panel-form input, .panel-form textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #ededed;
  font: 12.5px/1.4 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
  padding: 7px 9px;
  resize: vertical;
}
.panel-form textarea { min-height: 72px; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; font-size: 13px; }
.panel-form input::placeholder, .panel-form textarea::placeholder { color: #555; font-style: italic; }
.panel-form input:focus, .panel-form textarea:focus { outline: none; border-color: #F4C43F; box-shadow: 0 0 0 3px rgba(244, 196, 63, 0.18); }
.panel-form .insp-popup-actions { margin-top: 14px; }
.wt-btn.ghost { border-color: transparent; background: none; color: #a1a1a1; }
.wt-btn.ghost:hover { color: #ededed; background: rgba(255, 255, 255, 0.07); }
.wt-btn.danger { border-color: transparent; background: none; color: #ff9b8a; }
.wt-btn.danger:hover { background: rgba(255, 110, 90, 0.12); }
.toast {
  position: fixed;
  z-index: 2147483647;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: min(520px, calc(100vw - 32px));
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  animation: pop 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.wt-section { padding: 6px; }
.wt-head { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 8px 8px 6px; border-radius: 8px; cursor: pointer; }
.wt-head:hover, .wt-head:focus-visible { background: rgba(255, 255, 255, 0.05); }
.wt-head .chev { width: 16px; height: 16px; color: #a1a1a1; transition: transform 0.2s; flex-shrink: 0; }
.wt-head[aria-expanded="false"] .chev { transform: rotate(180deg); }
.wt-title { font-weight: 600; color: #fff; margin-right: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ticks { display: flex; gap: 2px; }
.ticks i { width: 2px; height: 11px; border-radius: 1px; background: rgba(255, 255, 255, 0.16); }
.ticks i.on { background: #F4C43F; }
.wt-count { font-size: 12px; color: #a1a1a1; font-variant-numeric: tabular-nums; white-space: nowrap; }
.steps { margin: 4px 0 2px; padding: 6px; border-radius: 10px; background: rgba(255, 255, 255, 0.035); border: 1px solid rgba(255, 255, 255, 0.06); }
.step-row { display: flex; align-items: center; border-radius: 7px; }
.step-row:hover { background: rgba(255, 255, 255, 0.06); }
.step, .add-step { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; padding: 7px 8px; border-radius: 7px; cursor: pointer; color: #ededed; }
.step:focus-visible, .add-step:focus-visible, .step-edit:focus-visible { outline: 2px solid #F4C43F; outline-offset: -2px; }
.step:disabled { cursor: default; opacity: 0.45; }
.step .label, .add-step .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { display: grid; place-items: center; width: 20px; height: 20px; flex-shrink: 0; border-radius: 6px; font-size: 11px; font-weight: 600; color: #a1a1a1; border: 1px solid rgba(255, 255, 255, 0.14); }
.num svg { width: 13px; height: 13px; }
.step-row.done .num { background: #F4C43F; border-color: #F4C43F; color: #10122F; }
.step-row.done .label { color: #8f8f8f; }
.step-row.current .num { background: #ededed; border-color: #ededed; color: #0c0c0e; }
.step-edit { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 26px; height: 26px; margin-right: 4px; border-radius: 6px; color: #8f8f8f; cursor: pointer; opacity: 0; }
.step-edit svg { width: 15px; height: 15px; }
.step-row:hover .step-edit, .step-edit:focus-visible { opacity: 1; }
.step-edit:hover { color: #F4C43F; background: rgba(255, 255, 255, 0.07); }
.step-edit:disabled { display: none; }
.add-step { color: #a1a1a1; }
.add-step .num { border-style: dashed; font-size: 14px; font-weight: 400; }
.add-step:hover { background: rgba(255, 255, 255, 0.06); color: #ededed; }
.wt-empty { margin: 4px 8px 6px; font-size: 12.5px; line-height: 1.5; color: #a1a1a1; }
.item-text { display: flex; flex-direction: column; gap: 1px; }
.menu-list { border-top: 1px solid rgba(255, 255, 255, 0.07); }
.menu { width: 320px; }
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

/** The data-tour value inside a selector like [data-tour="invoice-total"], if any. */
export function tourValue(selector: string): string | undefined {
  return selector.match(/data-tour=["']([^"']+)["']/)?.[1]
}

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
  private inspEl: HTMLElement | null = null
  private inspectedPath = location.pathname
  private listCollapsed = false
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
    const menu = document.createElement('div')
    menu.className = 'menu surface'
    menu.setAttribute('role', 'dialog')
    menu.setAttribute('aria-label', 'DocuGate tour')
    menu.append(this.walkthroughSection(), this.inspectorRow(), this.menuFooter())

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

  /**
   * The walkthrough as a checklist: progress at the top, then every step with
   * its state. Click a step to go there, the pencil to correct it, and the last
   * row to add one. A page with no walkthrough offers its first step.
   */
  private walkthroughSection(): HTMLElement {
    const stops = this.tour?.stops ?? []
    const seen = this.visited()
    const done = stops.filter((s) => seen.has(s.target)).length
    const current = stops.find((s) => !seen.has(s.target))

    const section = document.createElement('div')
    section.className = 'wt-section'

    const head = document.createElement('button')
    head.className = 'wt-head'
    head.setAttribute('aria-expanded', String(!this.listCollapsed))
    const ticks = 20
    const lit = stops.length ? Math.round((done / stops.length) * ticks) : 0
    head.innerHTML =
      `<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
      `<span class="wt-title"></span>` +
      (stops.length
        ? `<span class="ticks" aria-hidden="true">${Array.from({ length: ticks }, (_, i) => `<i class="${i < lit ? 'on' : ''}"></i>`).join('')}</span><span class="wt-count">${done}/${stops.length}</span>`
        : `<span class="wt-count">No steps yet</span>`)
    head.querySelector('.wt-title')!.textContent = this.tour?.title ?? 'Walkthrough'
    head.addEventListener('click', () => {
      this.listCollapsed = !this.listCollapsed
      this.openMenu()
    })
    section.appendChild(head)
    if (this.listCollapsed) return section

    const list = document.createElement('div')
    list.className = 'steps'
    stops.forEach((stop, i) => {
      const state = seen.has(stop.target) ? 'done' : stop === current ? 'current' : 'next'
      const onPage = document.querySelector(stop.target) !== null
      const row = document.createElement('div')
      row.className = `step-row ${state}`

      const go = document.createElement('button')
      go.className = 'step'
      go.disabled = !onPage
      go.title = onPage ? `Go to step ${i + 1}` : 'Not on the page right now'
      go.innerHTML =
        `<span class="num">${state === 'done' ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' : i + 1}</span><span class="label"></span>`
      go.querySelector('.label')!.textContent = stop.heading
      go.addEventListener('click', () => {
        this.closeMenu()
        this.startWalkthrough(stop)
      })
      row.appendChild(go)

      if (!this.isStaticMode) {
        const edit = document.createElement('button')
        edit.className = 'step-edit'
        edit.setAttribute('aria-label', `Edit step ${i + 1}, ${stop.heading}`)
        edit.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5l2 2L6 12H4v-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`
        edit.disabled = !onPage
        edit.addEventListener('click', () => {
          const el = document.querySelector(stop.target) as HTMLElement | null
          this.closeMenu()
          if (el) this.showInspPopup(el, stop, true)
        })
        row.appendChild(edit)
      }
      list.appendChild(row)
    })

    if (!stops.length) {
      const empty = document.createElement('p')
      empty.className = 'wt-empty'
      empty.textContent = this.isStaticMode
        ? 'This page has no walkthrough.'
        : 'This page has no walkthrough yet. Add the first step yourself, or let IBM Bob write it with docugate tour init.'
      list.appendChild(empty)
    }

    if (!this.isStaticMode) {
      const add = document.createElement('button')
      add.className = 'add-step'
      add.innerHTML = `<span class="num">+</span><span class="label"></span>`
      add.querySelector('.label')!.textContent = stops.length ? 'Add a step' : 'Add the first step'
      add.addEventListener('click', () => {
        this.closeMenu()
        if (!this.inspectorActive) this.toggleInspector()
        this.toast('Click the element this step should explain.')
      })
      list.appendChild(add)
    }
    section.appendChild(list)
    return section
  }

  /** One switch: while it is on, clicking anything shows its info, or lets you add it. */
  private inspectorRow(): HTMLElement {
    const row = document.createElement('div')
    row.className = 'menu-list'
    const b = document.createElement('button')
    b.className = 'menu-item'
    b.setAttribute('role', 'switch')
    b.setAttribute('aria-checked', String(this.inspectorActive))
    b.innerHTML = `<span class="item-text"><span></span><span class="menu-hint"></span></span><span class="switch" aria-hidden="true"></span>`
    const [label, hint] = b.querySelectorAll('.item-text span')
    label.textContent = 'Inspector'
    hint.textContent = this.isStaticMode ? 'Click anything to see what it is' : 'Click anything to see it, fix it, or add it'
    b.addEventListener('click', () => {
      this.closeMenu()
      this.toggleInspector()
    })
    row.appendChild(b)
    return row
  }

  private menuFooter(): HTMLElement {
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
    return foot
  }

  /** Steps seen on this screen in this tab, by target, so the checklist shows progress. */
  private visited(): Set<string> {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(`docugate-seen:${this.tour?.route ?? location.pathname}`) ?? '[]'))
    } catch {
      return new Set()
    }
  }

  private markVisited(target: string): void {
    const seen = this.visited()
    seen.add(target)
    try {
      sessionStorage.setItem(`docugate-seen:${this.tour?.route ?? location.pathname}`, JSON.stringify([...seen]))
    } catch {
      // progress is only shown for this session anyway
    }
  }

  private closeMenu(): void {
    this.menuEl?.remove()
    this.menuEl = null
    this.menuOpen = false
    this.pillBtn?.classList.remove('open')
    this.pillBtn?.setAttribute('aria-expanded', 'false')
  }

  // ── Walkthrough ───────────────────────────────────────────────────────────

  private startWalkthrough(from?: TourStop): void {
    if (!this.tour) return
    // Filter to stops whose target exists in the DOM
    this.wtStops = this.tour.stops.filter((s) => document.querySelector(s.target) !== null)
    if (!this.wtStops.length) return
    const startAt = from ? Math.max(0, this.wtStops.indexOf(from)) : 0

    this.walkthroughActive = true
    // The card needs the corner the badge sits in; it steps aside until Done.
    this.pillBtn?.classList.add('away')
    this.wtIndex = startAt
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
    this.markVisited(stop.target)

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

    if (!this.isStaticMode) {
      const edit = document.createElement('button')
      edit.className = 'wt-btn ghost'
      edit.textContent = 'Edit'
      edit.addEventListener('click', () => {
        const el = document.querySelector(stop.target) as HTMLElement | null
        this.stopWalkthrough()
        if (el) this.showInspPopup(el, stop, true)
      })
      nav.appendChild(edit)
    }

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

  // ── Stop panel: read a stop, or correct it, next to its element ──────────

  /**
   * One panel for everything about a stop. It opens reading (what this is and
   * where its data comes from) and turns into a form in place when the person
   * edits, so fixing something the AI got wrong never leaves the element.
   * With no stop, it opens as the form for a new one.
   */
  private showInspPopup(el: HTMLElement, stop: TourStop | null, editing = false): void {
    this.closeInspPopup()
    const panel = document.createElement('div')
    panel.className = 'insp-popup surface'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', stop ? stop.heading : 'Add to tour')
    this.shadow.appendChild(panel)
    this.inspPopup = panel
    this.inspEl = el
    if (stop && !editing) this.fillView(panel, el, stop)
    else this.fillForm(panel, el, stop)
    this.placeNear(panel, el)
  }

  private fillView(panel: HTMLElement, el: HTMLElement, stop: TourStop): void {
    panel.replaceChildren()
    const stops = this.tour?.stops ?? []
    const index = stops.findIndex((s) => s.target === stop.target)

    const eyebrow = document.createElement('p')
    eyebrow.className = 'wt-eyebrow'
    eyebrow.textContent = `${this.tour?.title ?? 'Tour'}${index >= 0 ? ` · stop ${index + 1} of ${stops.length}` : ''}`
    const heading = document.createElement('h3')
    heading.className = 'insp-popup-heading'
    heading.textContent = stop.heading
    panel.append(eyebrow, heading)

    if (stop.prose) {
      const prose = document.createElement('p')
      prose.className = 'insp-popup-prose'
      renderProse(prose, stop.prose)
      panel.appendChild(prose)
    }

    const section = document.createElement('p')
    section.className = 'panel-section'
    section.textContent = 'Where it comes from'
    panel.appendChild(section)

    const grid = document.createElement('div')
    grid.className = 'wt-fields'
    const find = tourValue(stop.target)
    const row = (label: string, content: Node) => {
      const lbl = document.createElement('span')
      lbl.className = 'insp-popup-label'
      lbl.textContent = label
      const val = document.createElement('span')
      val.className = 'insp-popup-val'
      val.appendChild(content)
      grid.append(lbl, val)
    }
    const fileLink = (path: string, findText?: string) => {
      if (this.isStaticMode) return document.createTextNode(breakable(path))
      const b = document.createElement('button')
      b.className = 'file-link'
      b.title = 'Open in your editor'
      b.textContent = breakable(path)
      b.addEventListener('click', () => this.openInEditor(path, findText))
      return b
    }
    if (stop.data) row('Data', document.createTextNode(stop.data))
    row('Code', fileLink(stop.code, find))
    if (stop.source) row('Source', fileLink(stop.source))
    if (stop.docs && /^https?:\/\//.test(stop.docs)) {
      const a = document.createElement('a')
      a.href = stop.docs
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = breakable(stop.docs)
      row('Docs', a)
    }
    panel.appendChild(grid)

    const actions = document.createElement('div')
    actions.className = 'insp-popup-actions'
    const where = document.createElement('span')
    where.className = 'panel-file'
    where.textContent = this.tour?.file ?? ''
    actions.appendChild(where)
    if (!this.isStaticMode) {
      const edit = document.createElement('button')
      edit.className = 'wt-btn'
      edit.textContent = 'Edit'
      edit.addEventListener('click', () => {
        this.fillForm(panel, el, stop)
        this.placeNear(panel, el)
      })
      actions.appendChild(edit)
    }
    const close = document.createElement('button')
    close.className = 'wt-btn primary'
    close.textContent = 'Close'
    close.addEventListener('click', () => this.closeInspPopup())
    actions.appendChild(close)
    panel.appendChild(actions)
    close.focus()
  }

  private fillForm(panel: HTMLElement, el: HTMLElement, existing: TourStop | null): void {
    panel.replaceChildren()
    panel.setAttribute('aria-label', existing ? `Edit ${existing.heading}` : 'Add to tour')
    const { selector, needsAttribute } = suggestSelector(el)

    const title = document.createElement('h3')
    title.className = 'insp-popup-heading'
    title.textContent = existing ? 'Edit this stop' : 'Add to tour'
    const hint = document.createElement('p')
    hint.className = 'panel-hint'
    hint.textContent = existing
      ? 'Correct anything that is wrong. Only this stop changes in the tour file.'
      : 'Say what this element is and where its data comes from.'
    panel.append(title, hint)

    const fields: Array<{ key: keyof TourStop; label: string; value: string; multi?: boolean; placeholder?: string }> = [
      { key: 'heading', label: 'Name', value: existing?.heading ?? '', placeholder: 'e.g. Total' },
      { key: 'prose', label: 'What it is', value: existing?.prose ?? '', multi: true, placeholder: 'e.g. The amount due: the subtotal plus tax, computed by `totals()`.' },
      { key: 'data', label: 'Data', value: existing?.data ?? '', placeholder: 'e.g. GET /api/invoices/:id → total' },
      { key: 'code', label: 'Code file', value: existing?.code ?? '', placeholder: 'e.g. src/screens/Invoice.tsx' },
      { key: 'source', label: 'Source file', value: existing?.source ?? '', placeholder: 'Optional: where the value is computed' },
      { key: 'docs', label: 'Docs link', value: existing?.docs ?? '', placeholder: 'Optional' },
      { key: 'target', label: 'Selector', value: existing?.target ?? selector },
    ]
    const inputs = {} as Record<keyof TourStop, HTMLInputElement | HTMLTextAreaElement>
    const form = document.createElement('form')
    form.className = 'panel-form'
    for (const f of fields) {
      const id = `dg-${f.key}`
      const label = document.createElement('label')
      label.htmlFor = id
      label.textContent = f.label
      const input = f.multi ? document.createElement('textarea') : document.createElement('input')
      input.id = id
      input.value = f.value
      if (f.placeholder) input.placeholder = f.placeholder
      if (f.key === 'target' || f.key === 'code') input.spellcheck = false
      form.append(label, input)
      inputs[f.key] = input
    }

    if (needsAttribute && !existing) {
      const warn = document.createElement('div')
      warn.className = 'add-form-warn'
      warn.append('Add ')
      const code = document.createElement('code')
      code.textContent = `data-tour="${tourValue(selector) ?? ''}"`
      warn.append(code, ' to this element in your code, so the stop keeps finding it.')
      form.appendChild(warn)
    }

    const error = document.createElement('p')
    error.className = 'panel-error'
    error.hidden = true
    form.appendChild(error)

    const actions = document.createElement('div')
    actions.className = 'insp-popup-actions'
    if (existing) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'wt-btn danger'
      remove.textContent = 'Remove'
      let armed = false
      remove.addEventListener('click', () => {
        if (!armed) {
          armed = true
          remove.textContent = 'Remove this stop?'
          return
        }
        this.removeStop(existing)
      })
      actions.appendChild(remove)
    }
    const spacer = document.createElement('span')
    spacer.className = 'panel-file'
    actions.appendChild(spacer)
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'wt-btn'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => {
      if (existing) {
        this.fillView(panel, el, existing)
        this.placeNear(panel, el)
      } else {
        this.closeInspPopup()
      }
    })
    const save = document.createElement('button')
    save.type = 'submit'
    save.className = 'wt-btn primary'
    save.textContent = existing ? 'Save' : 'Add stop'
    actions.append(cancel, save)
    form.appendChild(actions)

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const value = (k: keyof TourStop) => inputs[k].value.trim()
      const stop: TourStop = {
        heading: value('heading'),
        target: value('target'),
        data: value('data') || undefined,
        code: value('code'),
        source: value('source') || undefined,
        docs: value('docs') || undefined,
        prose: value('prose'),
      }
      const missing = !stop.heading ? 'a name' : !stop.code ? 'the code file' : !stop.target ? 'a selector' : ''
      if (missing) {
        error.textContent = `Add ${missing} first.`
        error.hidden = false
        return
      }
      save.disabled = true
      const saved = await this.saveStop(stop, existing?.target)
      save.disabled = false
      if (!saved) {
        error.textContent = 'Could not save. Is docugate tour serve still running?'
        error.hidden = false
        return
      }
      this.fillView(panel, el, stop)
      this.placeNear(panel, el)
    })

    panel.appendChild(form)
    ;(inputs[existing ? 'prose' : 'heading'] as HTMLElement).focus()
  }

  /** Puts the panel beside its element, below it when there is room, else above. */
  private placeNear(panel: HTMLElement, el: HTMLElement): void {
    const rect = el.getBoundingClientRect()
    const w = panel.offsetWidth || 360
    const h = panel.offsetHeight || 300
    const pad = 12
    let top = rect.bottom + 10
    if (top + h > window.innerHeight - pad) top = Math.max(pad, rect.top - h - 10)
    const left = Math.max(pad, Math.min(rect.left, window.innerWidth - w - pad))
    panel.style.top = `${top}px`
    panel.style.left = `${left}px`
  }

  private closeInspPopup(): void {
    this.inspPopup?.remove()
    this.inspPopup = null
    this.inspEl = null
  }

  private showAddForm(el: HTMLElement, existing?: TourStop): void {
    this.showInspPopup(el, existing ?? null, true)
  }

  private closeAddForm(): void {
    this.closeInspPopup()
  }

  private async saveStop(stop: TourStop, previousTarget?: string): Promise<boolean> {
    // A page with no tour yet starts one at its own path.
    const route = this.tour?.route ?? location.pathname
    try {
      const res = await fetch(`${this.base}/stop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route, stop, previousTarget }),
      })
      if (!res.ok) return false
      this.patchLocalStop(stop, previousTarget)
      this.toast(`Saved to ${this.tour?.file ?? '.docugate/tour/'}`)
      return true
    } catch {
      return false
    }
  }

  private async removeStop(stop: TourStop): Promise<void> {
    try {
      const res = await fetch(`${this.base}/stop`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: this.tour?.route ?? location.pathname, target: stop.target }),
      })
      if (!res.ok) throw new Error()
      if (this.tour) this.tour.stops = this.tour.stops.filter((s) => s.target !== stop.target)
      this.closeInspPopup()
      this.toast(`Removed "${stop.heading}"`)
    } catch {
      this.toast('Could not remove the stop. Is docugate tour serve still running?')
    }
  }

  /** Keeps the in-memory tour in step with a save, before the file watcher reports it. */
  private patchLocalStop(stop: TourStop, previousTarget?: string): void {
    if (!this.tour) {
      this.tour = { route: location.pathname, title: document.title || 'Tour', stops: [stop] }
      return
    }
    const i = this.tour.stops.findIndex((s) => s.target === (previousTarget ?? stop.target))
    if (i >= 0) this.tour.stops[i] = stop
    else this.tour.stops.push(stop)
  }

  private async openInEditor(path: string, find?: string): Promise<void> {
    try {
      const res = await fetch(`${this.base}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, find }),
      })
      if (!res.ok) throw new Error()
      this.toast(`Opened ${path.split('/').pop()}`)
    } catch {
      this.toast('Could not open your editor. Set DOCUGATE_EDITOR (for example: code) and restart docugate tour serve.')
    }
  }

  private toast(message: string): void {
    this.shadow.querySelector('.toast')?.remove()
    const t = document.createElement('div')
    t.className = 'toast surface'
    t.setAttribute('role', 'status')
    t.textContent = message
    this.shadow.appendChild(t)
    setTimeout(() => t.remove(), 3200)
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
    const path = location.pathname
    await this.load()
    if (this.walkthroughActive) this.stopWalkthrough()
    this.render()
    // A new page ends the inspection; an edit on this page keeps it going.
    if (this.inspectorActive && path !== this.inspectedPath) this.stopInspector()
    this.inspectedPath = path
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
