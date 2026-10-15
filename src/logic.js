// Pure game logic — no React, so it can be tested with plain node.

export const COLS = ['B', 'I', 'N', 'G', 'O']
export const FREE = '*'
export const letterOf = n => COLS[Math.min(4, Math.floor((n - 1) / 15))]

export const mkGrid = fill =>
  Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => fill(r, c)))
export const emptyForm  = () => mkGrid((r, c) => (r === 2 && c === 2 ? FREE : ''))
export const noManual   = () => mkGrid(() => false)
export const emptyPat   = () => mkGrid(() => false)

// ── Figure presets ────────────────────────────────────────────────────────────

export const FIGURE_PRESETS = {
  'Letra L':  (r, c) => c === 0 || (r === 4 && c <= 1),
  'Letra T':  (r, c) => r === 0 || c === 2,
  'Letra X':  (r, c) => r === c || r + c === 4,
  'Letra Z':  (r, c) => r === 0 || r === 4 || (r === 1 && c === 3) || (r === 3 && c === 1),
  'Letra U':  (r, c) => c === 0 || c === 4 || r === 4,
  'Letra C':  (r, c) => c === 0 || r === 0 || r === 4,
  'Letra H':  (r, c) => c === 0 || c === 4 || r === 2,
  Cruz:       (r, c) => r === 2 || c === 2,
  Esquinas:   (r, c) => (r === 0 || r === 4) && (c === 0 || c === 4),
  Marco:      (r, c) => r === 0 || r === 4 || c === 0 || c === 4,
  Diamante:   (r, c) => Math.abs(r - 2) + Math.abs(c - 2) === 2,
}
export const patFromPreset = name => mkGrid((r, c) => !!FIGURE_PRESETS[name](r, c))

// ── Prizes ────────────────────────────────────────────────────────────────────
//
//  { id, type: 'line' | 'figure' | 'full', name, dirs?: 'any' | 'rows', pattern? }
//  Each prize is independent: it is awarded the first time any card satisfies it
//  (all cards that satisfy it on that same call win together), in any order.

export const PRIZE_EMOJI = { line: '🥇', figure: '🥈', full: '🏆' }

export const defaultPrizes = () => [
  { id: 'p1', type: 'line',   name: 'Línea',        dirs: 'any' },
  { id: 'p2', type: 'figure', name: 'Cruz',         pattern: patFromPreset('Cruz') },
  { id: 'p3', type: 'full',   name: 'Cartón lleno' },
]

const allLines = dirs => {
  const lines = []
  for (let i = 0; i < 5; i++) {
    lines.push({ name: `fila ${i + 1}`, cells: [0, 1, 2, 3, 4].map(c => [i, c]) })
  }
  if (dirs !== 'rows') {
    for (let i = 0; i < 5; i++) {
      lines.push({ name: `columna ${COLS[i]}`, cells: [0, 1, 2, 3, 4].map(r => [r, i]) })
    }
    lines.push({ name: 'diagonal ↘', cells: [0, 1, 2, 3, 4].map(i => [i, i]) })
    lines.push({ name: 'diagonal ↗', cells: [0, 1, 2, 3, 4].map(i => [i, 4 - i]) })
  }
  return lines
}

export const completedLines = (m, dirs) =>
  allLines(dirs).filter(l => l.cells.every(([r, c]) => m[r][c])).map(l => l.name)

const patCells = pattern => {
  const out = []
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (pattern?.[r]?.[c]) out.push([r, c])
  return out
}

export function satisfies(p, m) {
  if (p.type === 'line')   return completedLines(m, p.dirs).length > 0
  if (p.type === 'figure') { const cells = patCells(p.pattern); return cells.length > 0 && cells.every(([r, c]) => m[r][c]) }
  return m.every(row => row.every(Boolean))
}

// How many cells are still missing for the card to satisfy the prize.
export function missing(p, m) {
  if (p.type === 'line') {
    return Math.min(...allLines(p.dirs).map(l => l.cells.filter(([r, c]) => !m[r][c]).length))
  }
  if (p.type === 'figure') return patCells(p.pattern).filter(([r, c]) => !m[r][c]).length
  return m.flat().filter(v => !v).length
}

// ── Cards ─────────────────────────────────────────────────────────────────────
//
//  card = { id, numbers: 5×5 (null = free space), manual: 5×5 bool }
//  `manual` flips a cell relative to the called numbers (manual mark / unmark).

export const cardMarked = (card, calledSet) =>
  mkGrid((r, c) => {
    const n = card.numbers[r][c]
    return n === null ? true : calledSet.has(n) !== card.manual[r][c]
  })

export const formToNumbers = f =>
  mkGrid((r, c) => (f[r][c] === FREE ? null : parseInt(f[r][c], 10)))
export const numbersToForm = nums =>
  mkGrid((r, c) => (nums[r][c] === null ? FREE : String(nums[r][c])))

export const sameNumbers = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Validates a 5×5 grid of strings. st[r][c] ∈ free | ok | warn | err.
// `warn` = number outside its usual column range (B 1-15, I 16-30, …): soft, never blocks.
export function analyzeForm(f) {
  const seen = {}
  f.forEach(row => row.forEach(v => { if (/^\d+$/.test(v)) seen[+v] = (seen[+v] || 0) + 1 }))
  const errors = new Set()
  let hasErr = false, warns = 0
  const st = mkGrid((r, c) => {
    const v = f[r][c]
    if (v === FREE) return 'free'
    if (v === '') { hasErr = true; errors.add('Hay casillas vacías'); return 'err' }
    if (!/^\d+$/.test(v)) { hasErr = true; errors.add('Valor no válido'); return 'err' }
    const n = +v
    if (n < 1 || n > 75) { hasErr = true; errors.add('Los números van de 1 a 75'); return 'err' }
    if (seen[n] > 1) { hasErr = true; errors.add('Número repetido'); return 'err' }
    if (n < c * 15 + 1 || n > c * 15 + 15) { warns++; return 'warn' }
    return 'ok'
  })
  return { st, errors: [...errors], valid: !hasErr, warns }
}

// ── Evaluating prizes ─────────────────────────────────────────────────────────
//
//  awards = { [prizeId]: { step, cardIds, last } }  — sticky once awarded.
//  Returns the updated awards and the ids of prizes awarded just now.

export function evaluate(cards, called, awards, prizes, viaCall = true) {
  const set = new Set(called)
  const marks = cards.map(c => cardMarked(c, set))
  const next = { ...awards }
  const fresh = []
  for (const p of prizes) {
    if (next[p.id]) continue
    const cardIds = cards.filter((_, i) => satisfies(p, marks[i])).map(c => c.id)
    if (cardIds.length) {
      next[p.id] = { step: called.length, cardIds, last: viaCall && called.length ? called[called.length - 1] : null }
      fresh.push(p.id)
    }
  }
  return { awards: next, fresh }
}

// ── Messages ──────────────────────────────────────────────────────────────────

export const prizeTitle = p =>
  p.type === 'figure' ? `FIGURA «${p.name.toUpperCase()}» COMPLETADA`
  : p.type === 'full' ? `${p.name.toUpperCase()} COMPLETADO`
  : `${p.name.toUpperCase()} COMPLETADA`

export function winMessage(p, cardIds, cards, called) {
  const set = new Set(called)
  const parts = cardIds.map(id => {
    const idx = cards.findIndex(c => c.id === id)
    if (idx < 0) return null
    let extra = ''
    if (p.type === 'line') {
      const l = completedLines(cardMarked(cards[idx], set), p.dirs)
      if (l.length) extra = ` (${l.join(' + ')})`
    }
    return `#${idx + 1}${extra}`
  }).filter(Boolean)
  return `${PRIZE_EMOJI[p.type]} ¡${prizeTitle(p)}!\nCartón${parts.length > 1 ? 'es' : ''} ${parts.join(', ')}`
}

// ── Text import ───────────────────────────────────────────────────────────────
//
//  Accepts 5 rows × 5 values per card, blank line (or a "Cartón N" line) between
//  cards. Values: numbers, * / FREE / LIBRE / ★ for the free space, ? for unknown.
//  If a card has only 24 values the free space is assumed in the center.

const TOKEN = /\d+|\*|★|\?|\b(?:free|libre|gratis)\b/gi
const HEADER = /^\s*(?:cart[oó]n|card)\b\s*#?\s*\d*\s*[:.)-]?/i

const tokToCell = t => (/^\d+$/.test(t) ? t : t === '?' ? '' : FREE)
const tokensToForm = t => {
  const cells = t.map(tokToCell)
  const full = cells.length === 24 ? [...cells.slice(0, 12), FREE, ...cells.slice(12)] : cells
  return mkGrid((r, c) => full[r * 5 + c] ?? '')
}

export function parseCardsText(text) {
  const blocks = [[]]
  for (const raw of text.replace(/```/g, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) { blocks.push([]); continue }
    if (HEADER.test(line)) { blocks.push([]); }
    const body = line.replace(HEADER, '')
    const toks = body.match(TOKEN) || []
    blocks[blocks.length - 1].push(...toks)
  }
  const out = []
  for (const toks of blocks) {
    if (!toks.length) continue
    let size = 25
    if (toks.length > 25 && toks.length % 25 !== 0 && toks.length % 24 === 0) size = 24
    if (toks.length <= 25) {
      const note = toks.length === 25 || toks.length === 24 ? ''
        : toks.length < 24 ? `Faltaron ${25 - toks.length} valores` : ''
      out.push({ form: tokensToForm(toks), note })
    } else {
      for (let i = 0; i < toks.length; i += size) {
        const chunk = toks.slice(i, i + size)
        const note = chunk.length < size ? `Faltaron ${size - chunk.length} valores` : ''
        out.push({ form: tokensToForm(chunk), note })
      }
    }
  }
  return out
}

export const AI_PROMPT = `Te voy a mandar fotos de cartones de bingo (cuadrícula de 5x5 con columnas B, I, N, G, O; números del 1 al 75).

Para CADA cartón responde SOLO con texto plano en este formato exacto:
- 5 líneas, una por fila (de arriba hacia abajo).
- En cada línea los 5 valores de izquierda a derecha, separados por un espacio.
- El espacio libre (la estrella del centro) escríbelo como *
- Si no logras leer un número con seguridad escribe ? en su lugar (no lo adivines).
- Deja UNA línea en blanco entre un cartón y el siguiente.
- Sin títulos, sin numerar los cartones, sin explicaciones, sin tablas ni bloques de código.

Ejemplo de respuesta con 2 cartones:
5 20 38 52 70
12 19 41 48 66
3 27 * 55 61
9 16 33 47 74
1 22 44 59 68

7 18 31 46 62
...

Procesa un máximo de 10 cartones por mensaje, en el orden en que te los envío.`
