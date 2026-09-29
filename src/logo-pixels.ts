// Generated from DocuGate's owl glyph by a script; the grid the terminal banner draws.
// Each character is one pixel: . transparent, c cream, g gold, d deep gold.
export const LOGO_PALETTE: Record<string, [number, number, number]> = {
  c: [245, 240, 227],
  g: [244, 196, 63],
  d: [217, 154, 30],
}

export const LOGO_ROWS: string[] = [
  '.....ccccccc..........cccccc......',
  '....ccccccccc........ccccccccc....',
  '...cccccccccccc....cccccccccccc...',
  '..ccccc...ccccc....ccccc...ccccc..',
  '.cccc....c..cccc..cccc....c..cccc.',
  '.ccc...ccccc.ccc..ccc...ccccc.ccc.',
  'cccc...cccccccccccccc..ccccccccccc',
  'ccc...ccccccc.cccccc...ccccccc.ccc',
  'ccc...ccccccc.cccccc...ccccccc.ccc',
  'ccc....ccccc..cccccc....ccccc..ccc',
  'ccc.....cccc..cccccc.....cccc..ccc',
  'cccc.........cccccccc.........cccc',
  '.ccc.........ccc..ccc.........ccc.',
  '.cccc.......ccc.gd.ccc.......cccc.',
  '..cccccc.ccccc.ggdd.ccccc.cccccc..',
  '...cccccccccc.gggddd.cccccccccc...',
  '....cccccccc.ggggdddd.cccccccc....',
  '......ccccc.gggggddddd.ccccc......',
  '.............ggggdddd.............',
  '..............gggddd..............',
  '..............gggddd..............',
  '...............ggdd...............',
  '................gd................',
  '................g.................',
]

/** The same owl as a small PNG, for terminals that can show real images. */
export const LOGO_PNG_BASE64 =
  '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'
