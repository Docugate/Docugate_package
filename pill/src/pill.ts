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

async function fetchTour(base: string): Promise<Tour | null> {
  const pathname = location.pathname
  if (window.DOCUGATE_TOUR) {
    const match = window.DOCUGATE_TOUR.find((t) => matchRoute(t.route, pathname))
    return match ?? null
  }
  try {
    const res = await fetch(`${base}/tour?path=${encodeURIComponent(pathname)}`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    return (await res.json()) as Tour
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// CSS (injected into shadow DOM)
// ---------------------------------------------------------------------------

const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

/* ── pill button ── */
.pill-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: #1a1a1a;
  color: #e8e8e8;
  border: 1px solid #333;
  border-radius: 999px;
  font: 12px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  user-select: none;
  letter-spacing: 0.01em;
  transition: background 0.15s;
}
.pill-btn:hover { background: #2a2a2a; }
.pill-btn:focus-visible { outline: 2px solid #4a90d9; outline-offset: 2px; }
.pill-dot {
  width: 6px;
  height: 6px;
  background: #4a90d9;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── menu ── */
.menu {
  position: fixed;
  bottom: 54px;
  right: 20px;
  z-index: 2147483647;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  overflow: hidden;
  font: 13px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
  min-width: 170px;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  color: #e0e0e0;
  text-align: left;
  cursor: pointer;
  font: inherit;
  transition: background 0.1s;
}
.menu-item:hover { background: #2a2a2a; }
.menu-item:focus-visible { outline: 2px solid #4a90d9; outline-offset: -2px; }
.menu-item + .menu-item { border-top: 1px solid #2a2a2a; }
.menu-item.active { color: #4a90d9; }

/* ── overlay / backdrop ── */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483640;
  pointer-events: none;
}

/* ── walkthrough card ── */
.wt-card {
  position: fixed;
  z-index: 2147483645;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 10px;
  padding: 18px 20px 14px;
  width: 320px;
  max-width: calc(100vw - 32px);
  font: 13px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #ddd;
}
.wt-card-heading {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 12px;
}
.wt-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
}
.wt-field-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #666;
}
.wt-field-value {
  font-size: 12px;
  color: #b0b0b0;
  word-break: break-all;
}
.wt-field-value a {
  color: #4a90d9;
  text-decoration: none;
}
.wt-field-value a:hover { text-decoration: underline; }
.wt-prose {
  font-size: 13px;
  color: #bbb;
  margin: 10px 0 14px;
  line-height: 1.55;
}
.wt-nav {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.wt-btn {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid #444;
  background: #252525;
  color: #ddd;
  font: 12px -apple-system, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.1s;
}
.wt-btn:hover { background: #333; }
.wt-btn:focus-visible { outline: 2px solid #4a90d9; outline-offset: 2px; }
.wt-btn.primary {
  background: #1e4a8a;
  border-color: #2a5fa0;
  color: #fff;
}
.wt-btn.primary:hover { background: #25559a; }
.wt-counter {
  font-size: 11px;
  color: #555;
  margin-right: auto;
  align-self: center;
}

/* ── inspector popup ── */
.insp-popup {
  position: fixed;
  z-index: 2147483645;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px 14px 10px;
  width: 280px;
  max-width: calc(100vw - 24px);
  font: 12px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #ccc;
  pointer-events: auto;
}
.insp-popup-heading {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  margin: 0 0 8px;
}
.insp-popup-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 7px;
}
.insp-popup-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #555;
}
.insp-popup-val {
  font-size: 12px;
  color: #aaa;
  word-break: break-all;
}
.insp-popup-val a { color: #4a90d9; text-decoration: none; }
.insp-popup-val a:hover { text-decoration: underline; }
.insp-popup-prose { font-size: 12px; color: #bbb; margin: 6px 0 10px; }
.insp-popup-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

/* ── add form ── */
.add-form {
  position: fixed;
  z-index: 2147483646;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 10px;
  padding: 18px 20px 14px;
  width: 340px;
  max-width: calc(100vw - 32px);
  font: 13px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  color: #ddd;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
.add-form-title { font-size: 14px; font-weight: 600; color: #fff; margin: 0 0 14px; }
.add-form label { display: block; font-size: 11px; color: #666; margin-bottom: 4px; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.add-form label:first-of-type { margin-top: 0; }
.add-form input, .add-form textarea {
  width: 100%;
  background: #111;
  border: 1px solid #333;
  border-radius: 5px;
  color: #ddd;
  font: 12px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif;
  padding: 6px 8px;
  resize: vertical;
}
.add-form input:focus, .add-form textarea:focus { outline: 2px solid #4a90d9; border-color: transparent; }
.add-form textarea { min-height: 60px; }
.add-form-warn {
  margin-top: 10px;
  font-size: 11px;
  color: #c09a40;
  background: #1e1a0a;
  border: 1px solid #3a2e0a;
  border-radius: 5px;
  padding: 7px 9px;
  line-height: 1.5;
}
.add-form-warn code { font-family: monospace; color: #e0b840; }
.add-form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }

/* ── reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; }
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
  ctx.strokeStyle = '#4a90d9'
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
  const cw = 320
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
    'border:2px solid #4a90d9',
    'border-radius:4px',
    'background:rgba(74,144,217,0.08)',
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
// Main Pill class
// ---------------------------------------------------------------------------

class DocugatePill {
  private shadow: ShadowRoot
  private host: HTMLElement
  private base: string
  private tour: Tour | null = null
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
    this.tour = await fetchTour(this.base)
    if (!this.tour && !this.isStaticMode) {
      // Server didn't respond — draw nothing
      return
    }
    this.render()
  }

  private render(): void {
    this.removePill()

    if (!this.tour) return

    const btn = document.createElement('button')
    btn.className = 'pill-btn'
    btn.setAttribute('aria-label', 'Docugate tour')
    btn.innerHTML = `<span class="pill-dot"></span>Tour`
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleMenu()
    })
    this.shadow.appendChild(btn)
    this.pillBtn = btn
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
    menu.className = 'menu'
    menu.setAttribute('role', 'menu')

    const walkBtn = document.createElement('button')
    walkBtn.className = 'menu-item'
    walkBtn.textContent = 'Walkthrough'
    walkBtn.setAttribute('role', 'menuitem')
    walkBtn.addEventListener('click', () => { this.closeMenu(); this.startWalkthrough() })

    const inspBtn = document.createElement('button')
    inspBtn.className = `menu-item${this.inspectorActive ? ' active' : ''}`
    inspBtn.textContent = this.inspectorActive ? 'Inspector: on' : 'Inspector'
    inspBtn.setAttribute('role', 'menuitem')
    inspBtn.addEventListener('click', () => { this.closeMenu(); this.toggleInspector() })

    menu.appendChild(walkBtn)
    menu.appendChild(inspBtn)
    this.shadow.appendChild(menu)
    this.menuEl = menu
    this.menuOpen = true

    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== this.pillBtn) {
        this.closeMenu()
        document.removeEventListener('click', close, true)
      }
    }
    document.addEventListener('click', close, true)
  }

  private closeMenu(): void {
    this.menuEl?.remove()
    this.menuEl = null
    this.menuOpen = false
  }

  // ── Walkthrough ───────────────────────────────────────────────────────────

  private startWalkthrough(): void {
    if (!this.tour) return
    // Filter to stops whose target exists in the DOM
    this.wtStops = this.tour.stops.filter((s) => document.querySelector(s.target) !== null)
    if (!this.wtStops.length) return

    this.walkthroughActive = true
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
    card.className = 'wt-card'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', stop.heading)

    const heading = document.createElement('h2')
    heading.className = 'wt-card-heading'
    heading.textContent = stop.heading
    card.appendChild(heading)

    const fields: Array<{ label: string; value: string; isLink?: boolean }> = []
    if (stop.data) fields.push({ label: 'Data', value: stop.data })
    fields.push({ label: 'Code', value: stop.code })
    if (stop.source) fields.push({ label: 'Source', value: stop.source })
    if (stop.docs) fields.push({ label: 'Docs', value: stop.docs, isLink: true })

    for (const f of fields) {
      const row = document.createElement('div')
      row.className = 'wt-field'
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
        a.textContent = f.value
        val.appendChild(a)
      } else {
        val.textContent = f.value
      }
      row.appendChild(lbl)
      row.appendChild(val)
      card.appendChild(row)
    }

    if (stop.prose) {
      const prose = document.createElement('p')
      prose.className = 'wt-prose'
      prose.textContent = stop.prose
      card.appendChild(prose)
    }

    const nav = document.createElement('div')
    nav.className = 'wt-nav'

    const counter = document.createElement('span')
    counter.className = 'wt-counter'
    counter.textContent = `${this.wtIndex + 1} / ${this.wtStops.length}`
    nav.appendChild(counter)

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
    this.highlightEl = createHighlightEl()
    document.body.appendChild(this.highlightEl)
    document.addEventListener('mousemove', this.boundHandleMouseMove, true)
    document.addEventListener('click', this.boundHandleClick, true)
    document.addEventListener('keydown', this.boundHandleKey)
  }

  private stopInspector(): void {
    this.inspectorActive = false
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
    popup.className = 'insp-popup'
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', stop.heading)

    const heading = document.createElement('h3')
    heading.className = 'insp-popup-heading'
    heading.textContent = stop.heading
    popup.appendChild(heading)

    const rows: Array<{ label: string; value: string; isLink?: boolean }> = []
    if (stop.data) rows.push({ label: 'Data', value: stop.data })
    rows.push({ label: 'Code', value: stop.code })
    if (stop.source) rows.push({ label: 'Source', value: stop.source })
    if (stop.docs) rows.push({ label: 'Docs', value: stop.docs, isLink: true })

    for (const r of rows) {
      const row = document.createElement('div')
      row.className = 'insp-popup-row'
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
        a.textContent = r.value
        val.appendChild(a)
      } else {
        val.textContent = r.value
      }
      row.appendChild(lbl)
      row.appendChild(val)
      popup.appendChild(row)
    }

    if (stop.prose) {
      const prose = document.createElement('p')
      prose.className = 'insp-popup-prose'
      prose.textContent = stop.prose
      popup.appendChild(prose)
    }

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
    popup.style.left = `${Math.min(rect.left, window.innerWidth - 296)}px`

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
    form.className = 'add-form'
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
    if (!this.tour) return
    try {
      await fetch(`${this.base}/stop`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route: this.tour.route, stop }),
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
    this.tour = await fetchTour(this.base)
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
