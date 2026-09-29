import { LOGO_PALETTE, LOGO_PNG_BASE64, LOGO_ROWS } from './logo-pixels.js'

// DocuGate's owl in the terminal. Terminals that show real images (iTerm2,
// WezTerm) get the picture; every other color terminal gets it drawn with
// half blocks, two pixels per character cell, in full color where the
// terminal supports it and in the nearest of 256 colors where it does not.

type Rgb = [number, number, number]

/** How much color this terminal shows, from what it says about itself. */
export function colorDepth(env: NodeJS.ProcessEnv = process.env): 'truecolor' | '256' {
  const term = `${env.COLORTERM ?? ''} ${env.TERM ?? ''}`.toLowerCase()
  if (/truecolor|24bit|direct/.test(term)) return 'truecolor'
  if (env.WT_SESSION || env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'WezTerm') {
    return 'truecolor'
  }
  return '256'
}

/** Whether the terminal draws inline images (the iTerm2 image protocol). */
export function showsImages(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'WezTerm'
}

/** The nearest color of the xterm 256-color cube. */
function to256([r, g, b]: Rgb): number {
  const step = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)))
  return 16 + 36 * step(r) + 6 * step(g) + step(b)
}

function fg(rgb: Rgb, depth: 'truecolor' | '256'): string {
  return depth === 'truecolor' ? `\x1b[38;2;${rgb.join(';')}m` : `\x1b[38;5;${to256(rgb)}m`
}

function bg(rgb: Rgb, depth: 'truecolor' | '256'): string {
  return depth === 'truecolor' ? `\x1b[48;2;${rgb.join(';')}m` : `\x1b[48;5;${to256(rgb)}m`
}

/**
 * The owl as lines of colored half blocks: each character is the pixel above
 * (its color) and the pixel below (its background). Transparent pixels show
 * the terminal's own background, so it sits well on dark and light themes.
 */
export function logoCells(depth: 'truecolor' | '256' = colorDepth()): string[] {
  const lines: string[] = []
  for (let y = 0; y < LOGO_ROWS.length; y += 2) {
    const top = LOGO_ROWS[y]
    const bottom = LOGO_ROWS[y + 1] ?? ''
    let line = ''
    for (let x = 0; x < top.length; x++) {
      const up = LOGO_PALETTE[top[x]]
      const down = LOGO_PALETTE[bottom[x] ?? '.']
      if (up && down) line += `${fg(up, depth)}${bg(down, depth)}▀\x1b[0m`
      else if (up) line += `${fg(up, depth)}▀\x1b[0m`
      else if (down) line += `${fg(down, depth)}▄\x1b[0m`
      else line += ' '
    }
    lines.push(line)
  }
  return lines
}

/** The owl as a real image, for terminals that draw them: one escape sequence. */
export function logoImage(rows = 5): string {
  return `\x1b]1337;File=inline=1;height=${rows};preserveAspectRatio=1:${LOGO_PNG_BASE64}\x07`
}

/**
 * The banner: the owl on the left and `text` beside it, vertically centered.
 * `text` lines may carry their own color codes.
 */
export function logoBanner(text: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  if (showsImages(env)) return ['', `  ${logoImage()}`, ...text.map((t) => `  ${t}`)]
  const cells = logoCells(colorDepth(env))
  const start = Math.max(0, Math.floor((cells.length - text.length) / 2))
  return ['', ...cells.map((cell, i) => `  ${cell}   ${text[i - start] ?? ''}`.trimEnd()), '']
}
