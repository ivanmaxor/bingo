import { useState, useEffect, useRef, useCallback } from 'react'

// ── External libs ─────────────────────────────────────────────────────────────

function loadConfetti() {
  return new Promise(resolve => {
    if (window.confetti) { resolve(window.confetti); return }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js'
    s.onload = () => resolve(window.confetti)
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
}

function playWinSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[523, 659, 784, 1047, 1319].forEach((freq, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = freq
      const t = ctx.currentTime + i * 0.16
      g.gain.setValueAtTime(0.35, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
      o.start(t); o.stop(t + 0.45)
    })
  } catch (_) {}
}

// ── Grid helpers ──────────────────────────────────────────────────────────────

const COLS     = ['B', 'I', 'N', 'G', 'O']
const isFree   = (r, c) => r === 2 && c === 2
const mkGrid   = fill => Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => fill(r, c)))
const mkMarked = () => mkGrid((r, c) => isFree(r, c))
const mkEmpty  = () => Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ''))

// ── Figure presets ────────────────────────────────────────────────────────────

const FIGURE_PRESETS = {
  L:    (r, c) => c === 0 || (r === 4 && c <= 1),
  T:    (r, c) => r === 0 || c === 2,
  X:    (r, c) => r === c || r + c === 4,
  Z:    (r, c) => r === 0 || r === 4 || (r === 1 && c === 3) || (r === 3 && c === 1),
  U:    (r, c) => c === 0 || c === 4 || r === 4,
  Cruz: (r, c) => r === 2 || c === 2,
}
const mkFigure = fn => mkGrid((r, c) => fn(r, c) || isFree(r, c))

// ── Win checks ────────────────────────────────────────────────────────────────

function checkLine(m) {
  for (let i = 0; i < 5; i++) {
    if (m[i].every(Boolean)) return true
    if (m.every(row => row[i])) return true
  }
  return [0,1,2,3,4].every(i => m[i][i]) || [0,1,2,3,4].every(i => m[i][4-i])
}
const checkFigure = (m, pat) => pat.every((row, r) => row.every((v, c) => !v || m[r][c]))
const checkFull   = m => m.every(row => row.every(Boolean))

function stageCheck(s, marked, pat) {
  if (s === 1) return checkLine(marked)
  if (s === 2) return checkFigure(marked, pat)
  return checkFull(marked)
}

// ── Stage metadata ────────────────────────────────────────────────────────────
//
//  Stage 1 → Línea       (any row / col / diagonal)   — game continues
//  Stage 2 → Figura      (custom figure)              — game continues
//  Stage 3 → Cartón Lleno (every cell filled)         — game ends

const STAGES = {
  1: { badge: 'line',   label: 'LÍNEA',       emoji: '🥇', name: 'Línea' },
  2: { badge: 'figure', label: 'FIGURA',       emoji: '🥈', name: 'Figura' },
  3: { badge: 'full',   label: 'CARTÓN LLENO', emoji: '🏆', name: 'Cartón Lleno' },
}

// Evaluates stages in order starting from startStage, chaining if possible.
function evaluateStages(cards, startStage, pat) {
  let cur = cards
  let s   = startStage
  const resolutions = []

  while (s <= 3) {
    const { badge } = STAGES[s]
    const winners = cur.filter(c => !c.badges.includes(badge) && stageCheck(s, c.marked, pat))
    if (!winners.length) break
    cur = cur.map(c =>
      winners.some(w => w.id === c.id) ? { ...c, badges: [...c.badges, badge] } : c
    )
    resolutions.push({ stageNum: s, winners })
    s++
  }

  return { cards: cur, resolutions, nextStage: s }
}

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#7C3AED','#6D28D9','#4F46E5','#2563EB','#1D4ED8','#0284C7',
  '#0891B2','#0F766E','#059669','#16A34A','#65A30D','#CA8A04',
  '#D97706','#EA580C','#DC2626','#DB2777','#C026D3','#374151',
]

function hexToRgbParts(hex) {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16)]
}
function syncCssColor(hex) {
  const [R, G, B] = hexToRgbParts(hex)
  const d = document.documentElement.style
  d.setProperty('--primary',      `rgb(${R},${G},${B})`)
  d.setProperty('--primary-a35',  `rgba(${R},${G},${B},0.35)`)
  d.setProperty('--primary-a12',  `rgba(${R},${G},${B},0.12)`)
  d.setProperty('--primary-dark', `rgb(${Math.max(0,R-40)},${Math.max(0,G-40)},${Math.max(0,B-40)})`)
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm">
      {title && (
        <p className="font-bold text-gray-500 mb-3 text-xs uppercase tracking-wider">{title}</p>
      )}
      {children}
    </div>
  )
}

// 5×5 input grid — cells are touch-friendly and prevent iOS-zoom (font ≥ 16 px)
function CardFormGrid({ form, onChange, onSubmit }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="inline-block min-w-full">
        {/* Column headers */}
        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map(l => (
            <div key={l}
              className="w-12 sm:w-14 text-center text-sm font-black bebas tracking-wider"
              style={{ color: 'var(--primary)' }}>
              {l}
            </div>
          ))}
        </div>
        {/* Input cells */}
        <div className="grid grid-cols-5 gap-1">
          {mkGrid((r, c) =>
            isFree(r, c)
              ? <div key={`${r}${c}`}
                  className="w-12 sm:w-14 h-11 sm:h-12 rounded-xl flex items-center justify-center
                    text-white font-black bebas tracking-widest text-xs sm:text-sm"
                  style={{ background: 'var(--primary)' }}>
                  FREE
                </div>
              : <input key={`${r}${c}`} type="number" min="1" max="75"
                  value={form[r][c]}
                  onChange={e => onChange(r, c, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && onSubmit?.()}
                  // text-base keeps font ≥ 16px, preventing iOS auto-zoom on focus
                  className="w-12 sm:w-14 h-11 sm:h-12 rounded-xl border-2 text-center
                    font-bold text-base focus:outline-none transition-colors"
                  style={{ borderColor: form[r][c] ? 'var(--primary)' : '#e5e7eb' }}
                  placeholder="—"
                  inputMode="numeric" />
          )}
        </div>
      </div>
    </div>
  )
}

// 30×30 px dot preview for figure preset buttons
function MiniPattern({ fn }) {
  return (
    <div className="grid grid-cols-5 gap-px" style={{ width: 30, height: 30 }}>
      {mkGrid((r, c) => (
        <div key={`${r}${c}`} className="rounded-sm" style={{
          background: fn(r,c)||isFree(r,c) ? 'var(--primary)' : '#d1d5db',
          opacity:    isFree(r,c) ? 0.55 : 1,
        }} />
      ))}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  // ─ Shared config ─
  const [screen,  setScreen]  = useState('config')
  const [color,   setColor]   = useState('#7C3AED')
  const [rainbow, setRainbow] = useState(false)
  const [pat,     setPat]     = useState(() => mkFigure(FIGURE_PRESETS.Cruz))

  // ─ Config card builder ─
  const [form,      setForm]      = useState(mkEmpty)
  const [cards,     setCards]     = useState([])
  const [cardError, setCardError] = useState('')

  // ─ Game ─
  const [gameCards, setGameCards] = useState([])
  const [called,    setCalled]    = useState([])
  const [stage,     setStage]     = useState(1)
  const [gameOver,  setGameOver]  = useState(false)
  const [numInput,  setNumInput]  = useState('')
  const [gameError, setGameError] = useState('')
  const [toast,     setToast]     = useState(null)

  // ─ Mid-game add-card modal ─
  const [modalOpen,  setModalOpen]  = useState(false)
  const [modalForm,  setModalForm]  = useState(mkEmpty)
  const [modalError, setModalError] = useState('')

  const inputRef    = useRef(null)
  const ballsRef    = useRef(null)
  const toastTimer  = useRef(null)

  useEffect(() => { syncCssColor(color) }, [color])
  useEffect(() => { loadConfetti() }, [])

  // ── Config handlers ───────────────────────────────────────────────────────

  const togglePat = (r, c) => {
    if (isFree(r, c)) return
    setPat(p => p.map((row, ri) => row.map((v, ci) => ri===r&&ci===c ? !v : v)))
  }

  const updateForm = (r, c, val) =>
    setForm(f => f.map((row, ri) => row.map((v, ci) => ri===r&&ci===c ? val : v)))

  function validateCardForm(f) {
    const nums = []
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (isFree(r, c)) continue
      const n = parseInt(f[r][c])
      if (isNaN(n) || n < 1 || n > 75) return 'Todos los números deben ser entre 1 y 75'
      nums.push(n)
    }
    if (new Set(nums).size < nums.length) return 'No puede haber números repetidos'
    return null
  }

  const addCard = () => {
    const err = validateCardForm(form)
    if (err) { setCardError(err); return }
    setCardError('')
    setCards(prev => [...prev, {
      id: Date.now(),
      numbers: mkGrid((r, c) => isFree(r,c) ? null : parseInt(form[r][c])),
    }])
    setForm(mkEmpty())
  }

  const startGame = () => {
    setGameCards(cards.map((card, i) => ({
      ...card, idx: i+1, marked: mkMarked(), badges: [],
    })))
    setCalled([]); setNumInput(''); setStage(1); setGameOver(false)
    setToast(null); setGameError('')
    setScreen('game')
  }

  // ── Stage-win announcement ────────────────────────────────────────────────

  const fireStageWin = useCallback((stageNum, winners) => {
    const { emoji, label } = STAGES[stageNum]
    const list = winners.map(w => w.idx).join(', #')
    setToast({
      msg: `${emoji} ¡${label}!\nCartón${winners.length > 1 ? 'es' : ''} #${list}`,
      stageNum,
    })
    playWinSound()
    loadConfetti().then(f => f && f({ particleCount: 230, spread: 110, origin: { y: 0.55 } }))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // ── Game: call number ─────────────────────────────────────────────────────

  const callNum = useCallback(() => {
    if (gameOver) return
    const n = parseInt(numInput)
    if (isNaN(n) || n < 1 || n > 75) { setGameError('Número entre 1 y 75'); return }
    if (called.includes(n))           { setGameError('Ya fue cantado'); return }
    setGameError('')

    const newCalled = [...called, n]
    setCalled(newCalled)
    setNumInput('')

    const markedCards = gameCards.map(card => ({
      ...card,
      marked: card.marked.map((row, r) =>
        row.map((v, c) => isFree(r,c) ? true : v || card.numbers[r][c] === n)
      ),
    }))

    const { cards: finalCards, resolutions, nextStage } = evaluateStages(markedCards, stage, pat)
    setGameCards(finalCards)

    if (resolutions.length > 0) {
      setStage(Math.min(nextStage, 3))
      if (nextStage > 3) setGameOver(true)
      resolutions.forEach(({ stageNum, winners }, i) => {
        setTimeout(() => fireStageWin(stageNum, winners), i * 3500)
      })
    }

    setTimeout(() => {
      if (ballsRef.current) ballsRef.current.scrollLeft = ballsRef.current.scrollWidth
    }, 40)
  }, [numInput, called, gameCards, stage, pat, gameOver, fireStageWin])

  // ── Game: undo ────────────────────────────────────────────────────────────

  const undoLast = () => {
    if (!called.length) return
    const newCalled = called.slice(0, -1)
    setCalled(newCalled)
    setToast(null)
    if (toastTimer.current) clearTimeout(toastTimer.current)

    const recalc = gameCards.map(card => ({
      ...card,
      badges: [],
      marked: card.numbers.map((row, r) =>
        row.map((v, c) => isFree(r,c) ? true : newCalled.includes(v))
      ),
    }))
    const { cards: finalCards, nextStage } = evaluateStages(recalc, 1, pat)
    setGameCards(finalCards)
    setStage(Math.min(nextStage, 3))
    setGameOver(nextStage > 3)
  }

  // ── Game: manual cell toggle ──────────────────────────────────────────────

  const toggleCell = (cardId, r, c) => {
    if (isFree(r, c) || gameOver) return
    setGameCards(prev => prev.map(card => {
      if (card.id !== cardId) return card
      return {
        ...card,
        marked: card.marked.map((row, ri) => row.map((v, ci) => ri===r&&ci===c ? !v : v)),
      }
    }))
  }

  // ── Game: add card via modal ──────────────────────────────────────────────

  const addCardInGame = () => {
    const err = validateCardForm(modalForm)
    if (err) { setModalError(err); return }
    setModalError('')
    const preMarked = mkGrid((r, c) =>
      isFree(r,c) ? true : called.includes(parseInt(modalForm[r][c]))
    )
    setGameCards(prev => [...prev, {
      id:      Date.now(),
      idx:     prev.length + 1,
      numbers: mkGrid((r, c) => isFree(r,c) ? null : parseInt(modalForm[r][c])),
      marked:  preMarked,
      badges:  [],
    }])
    setModalForm(mkEmpty())
    setModalOpen(false)
  }

  const openModal = () => { setModalForm(mkEmpty()); setModalError(''); setModalOpen(true) }

  const newGame = () => {
    setScreen('config')
    setCards([]); setCalled([]); setGameCards([])
    setStage(1); setGameOver(false)
    setNumInput(''); setToast(null); setGameError(''); setCardError('')
    setForm(mkEmpty())
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CONFIG SCREEN
  // ══════════════════════════════════════════════════════════════════════════

  if (screen === 'config') return (
    <div className="min-h-screen bg-gray-50 pb-12">

      {/* Header */}
      <header className={`text-white text-center py-8 sm:py-10 mb-5 shadow-xl ${rainbow ? 'is-rainbow' : ''}`}
        style={{ background: rainbow ? undefined : 'var(--primary)' }}>
        <h1 className="bebas text-6xl sm:text-7xl text-white select-none drop-shadow-lg"
          style={{ letterSpacing: '0.35em' }}>
          BINGO
        </h1>
        <p className="text-xs opacity-60 tracking-[0.2em] uppercase mt-1 font-medium">
          Configuración de partida
        </p>
      </header>

      <div className="max-w-xl mx-auto px-3 sm:px-4 space-y-4">

        {/* ── Color picker ── */}
        <Section title="Color primario">
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Native color picker trigger */}
              <div className="relative cursor-pointer flex-shrink-0">
                <input type="color" value={color}
                  onChange={e => { setColor(e.target.value); setRainbow(false) }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 pointer-events-none
                  font-mono text-sm font-bold select-none"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                  <span className="w-6 h-6 rounded-lg border border-black/10 shadow-sm flex-shrink-0"
                    style={{ background: color }} />
                  {color.toUpperCase()}
                </div>
              </div>
              {/* Rainbow toggle */}
              <button onClick={() => setRainbow(r => !r)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-sm font-bold
                  transition-all hover:scale-105 active:scale-95 select-none flex-shrink-0
                  ${rainbow ? 'is-rainbow text-white border-transparent' : 'border-gray-200 text-gray-500'}`}>
                🌈 Arcoíris{rainbow ? ' ✓' : ''}
              </button>
            </div>
            {/* Color swatches — wrap naturally */}
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map(c => (
                <button key={c} onClick={() => { setColor(c); setRainbow(false) }}
                  className="w-8 h-8 rounded-full transition-all hover:scale-110 active:scale-95 shadow-sm"
                  style={{
                    background:    c,
                    outline:       !rainbow && c === color ? `3px solid ${c}` : 'none',
                    outlineOffset: '2px',
                  }} />
              ))}
            </div>
          </div>
        </Section>

        {/* ── Stage info ── */}
        <Section title="Etapas de la partida">
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map(s => {
              const { emoji, name } = STAGES[s]
              const desc = s === 1 ? 'Primera fila, columna o diagonal completa.' :
                           s === 2 ? 'Primera figura completa (configurable abajo).' :
                                     'Primer cartón con todas las celdas marcadas. Fin de la partida.'
              return (
                <div key={s} className="flex items-start gap-3 p-3 rounded-xl bg-gray-50">
                  <span className="text-xl flex-shrink-0">{emoji}</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">
                      Etapa {s}: <span style={{ color: 'var(--primary)' }}>{name}</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Figure pattern (stage 2) ── */}
        <Section title="Figura — Etapa 2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Figuras predefinidas
          </p>
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(FIGURE_PRESETS).map(([name, fn]) => (
              <button key={name} onClick={() => setPat(mkFigure(fn))}
                className="flex flex-col items-center gap-1.5 px-3 pt-2.5 pb-2 rounded-xl border-2
                  transition-all hover:shadow-md hover:scale-105 active:scale-95"
                style={{ borderColor: 'var(--primary-a35)' }}>
                <MiniPattern fn={fn} />
                <span className="text-xs font-black bebas tracking-wider"
                  style={{ color: 'var(--primary)' }}>
                  {name}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Toca para personalizar. <strong className="text-gray-700">★</strong> = FREE SPACE.
          </p>
          <div className="inline-block">
            <div className="grid grid-cols-5 gap-1 mb-1">
              {COLS.map(l => (
                <div key={l} className="w-11 text-center text-xs font-black bebas tracking-wider"
                  style={{ color: 'var(--primary)' }}>{l}</div>
              ))}
            </div>
            <div className="grid grid-cols-5 gap-1">
              {mkGrid((r, c) => (
                <button key={`${r}${c}`} onClick={() => togglePat(r, c)}
                  className="bingo-cell w-11 h-11 rounded-xl text-sm font-bold"
                  style={{
                    background: pat[r][c] ? 'var(--primary)' : '#e5e7eb',
                    color:      pat[r][c] ? '#fff'            : '#9ca3af',
                    cursor:     isFree(r,c) ? 'default' : 'pointer',
                    boxShadow:  pat[r][c] ? '0 2px 8px var(--primary-a35)' : 'none',
                    transform:  pat[r][c] && !isFree(r,c) ? 'scale(1.07)' : 'scale(1)',
                  }}>
                  {isFree(r,c) ? '★' : pat[r][c] ? '✓' : '·'}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            {pat.flat().filter(Boolean).length} celda(s) seleccionada(s)
          </p>
        </Section>

        {/* ── Card builder ── */}
        <Section title="Agregar cartón">
          {cardError && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200
              text-red-600 text-sm font-medium">
              {cardError}
            </div>
          )}
          <CardFormGrid form={form} onChange={updateForm} onSubmit={addCard} />
          <button onClick={addCard}
            className="mt-4 w-full py-3 rounded-xl font-bold text-white text-sm
              transition-all hover:opacity-90 active:scale-95 shadow-md"
            style={{ background: 'var(--primary)' }}>
            + Agregar cartón
          </button>
        </Section>

        {/* ── Saved card thumbnails ── */}
        {cards.length > 0 && (
          <Section title={`Cartones (${cards.length})`}>
            <div className="flex flex-wrap gap-3">
              {cards.map((card, i) => (
                <div key={card.id}
                  className="relative border-2 rounded-xl p-2 transition-shadow hover:shadow-md"
                  style={{ borderColor: 'var(--primary-a35)' }}>
                  <p className="text-center text-xs font-black mb-1 bebas tracking-wider"
                    style={{ color: 'var(--primary)' }}>
                    #{i+1}
                  </p>
                  <div className="grid grid-cols-5 gap-px">
                    {card.numbers.map((row, r) => row.map((n, c) => (
                      <div key={`${r}${c}`}
                        className="w-6 h-5 flex items-center justify-center rounded"
                        style={{
                          background: isFree(r,c) ? 'var(--primary)' : '#f3f4f6',
                          color:      isFree(r,c) ? '#fff'             : '#374151',
                          fontSize: '8px', fontWeight: 700,
                        }}>
                        {isFree(r,c) ? '★' : n}
                      </div>
                    )))}
                  </div>
                  <button onClick={() => setCards(prev => prev.filter(cc => cc.id !== card.id))}
                    className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500
                      text-white font-bold flex items-center justify-center leading-none shadow-md
                      hover:bg-red-600 transition-colors text-sm">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Start button ── */}
        <button onClick={startGame} disabled={cards.length === 0}
          className="w-full py-4 rounded-2xl text-white shadow-lg transition-all
            hover:shadow-xl hover:opacity-95 active:scale-95
            disabled:opacity-40 disabled:cursor-not-allowed bebas tracking-widest"
          style={{ background: 'var(--primary)', fontSize: '1.5rem' }}>
          INICIAR PARTIDA →
        </button>
        {cards.length === 0 && (
          <p className="text-center text-gray-400 text-xs -mt-2">
            Agrega al menos un cartón para comenzar
          </p>
        )}
      </div>
    </div>
  )

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME SCREEN
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-gray-100">

      {/* ── Victory toast ── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 z-50 bebas tracking-wider text-white
          px-6 py-3 rounded-2xl shadow-2xl text-center pointer-events-none toast-enter
          whitespace-pre-line ${rainbow ? 'is-rainbow' : ''}`}
          style={{
            maxWidth: '88vw', fontSize: 'clamp(1.1rem, 5vw, 1.6rem)',
            lineHeight: 1.2,
            background: rainbow ? undefined : 'var(--primary)',
            transform: 'translateX(-50%)',
          }}>
          {toast.msg}
        </div>
      )}

      {/* ── Add-card modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          {/* Sheet slides up from bottom on mobile, centered on desktop */}
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm p-5 sm:p-6">
            {/* Drag handle (mobile) */}
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4 sm:hidden" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-gray-800">Agregar cartón</h2>
              <button onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500
                  flex items-center justify-center font-bold text-lg leading-none transition-colors">
                ×
              </button>
            </div>
            {modalError && (
              <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200
                text-red-600 text-sm font-medium">
                {modalError}
              </div>
            )}
            <CardFormGrid
              form={modalForm}
              onChange={(r,c,v) =>
                setModalForm(f => f.map((row,ri) => row.map((vv,ci) => ri===r&&ci===c ? v : vv)))
              }
              onSubmit={addCardInGame}
            />
            {called.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {called.length} número(s) ya cantados se marcarán automáticamente.
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModalOpen(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-500 font-bold
                  text-sm hover:border-gray-300 active:scale-95 transition-all">
                Cancelar
              </button>
              <button onClick={addCardInGame}
                className="flex-1 py-3 rounded-xl text-white font-bold text-sm
                  hover:opacity-90 active:scale-95 transition-all shadow-md"
                style={{ background: 'var(--primary)' }}>
                + Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className={`text-white shadow-lg ${rainbow ? 'is-rainbow' : ''}`}
        style={{ background: rainbow ? undefined : 'var(--primary)' }}>

        {/* Top row: title + action buttons */}
        <div className="px-3 sm:px-4 pt-3 pb-1.5 flex items-center gap-1.5 sm:gap-2">
          <h1 className="bebas text-2xl sm:text-3xl text-white flex-1 select-none"
            style={{ letterSpacing: '0.2em' }}>
            BINGO
          </h1>

          {/* "+ Cartón" hidden on mobile (uses FAB instead) */}
          <button onClick={openModal}
            className="hidden sm:flex px-3 py-1.5 rounded-lg text-xs font-bold
              bg-white/20 hover:bg-white/30 transition-all active:scale-95 whitespace-nowrap">
            + Cartón
          </button>

          <button onClick={undoLast} disabled={!called.length || gameOver}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30
              disabled:opacity-40 transition-all active:scale-95 whitespace-nowrap">
            ↩<span className="hidden sm:inline"> Deshacer</span>
          </button>

          <button onClick={newGame}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30
              transition-all active:scale-95 whitespace-nowrap">
            ✕<span className="hidden sm:inline"> Nueva</span>
          </button>
        </div>

        {/* Stage pills */}
        <div className="px-3 sm:px-4 pb-3 flex items-center gap-1.5 flex-wrap">
          {[1, 2, 3].map(s => {
            const { emoji, name } = STAGES[s]
            const isActive = s === stage && !gameOver
            const isDone   = s < stage || gameOver
            return (
              <div key={s}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold
                  transition-all duration-300 select-none
                  ${isActive ? 'bg-white text-gray-800 shadow-md scale-105' :
                    isDone   ? 'bg-white/30 text-white/90' : 'bg-white/10 text-white/40'}`}>
                <span>{emoji}</span>
                <span className="hidden sm:inline">{name}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot ml-0.5 inline-block" />
                )}
                {isDone && <span className="ml-0.5 opacity-80">✓</span>}
              </div>
            )
          })}
          {gameOver && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold
              bg-yellow-400 text-yellow-900 ml-1">
              🎊 ¡Fin!
            </span>
          )}
        </div>
      </header>

      {/* ── Floating action button — "+ Cartón" on mobile only ── */}
      {!gameOver && (
        <button onClick={openModal}
          className="fixed bottom-5 right-4 z-30 sm:hidden w-14 h-14 rounded-full
            text-white text-3xl font-bold flex items-center justify-center
            shadow-2xl active:scale-90 transition-transform"
          style={{ background: 'var(--primary)' }}
          aria-label="Agregar cartón">
          +
        </button>
      )}

      <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3 sm:space-y-4">

        {/* ── Number input ── */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <div className="flex gap-2 sm:gap-3">
            <input
              ref={inputRef} type="number" min="1" max="75"
              inputMode="numeric"
              value={numInput}
              onChange={e => setNumInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && callNum()}
              disabled={gameOver}
              className="flex-1 h-14 sm:h-16 rounded-xl border-2 text-center font-black
                focus:outline-none transition-colors bebas tracking-widest
                disabled:bg-gray-50 disabled:text-gray-300"
              style={{
                borderColor: numInput ? 'var(--primary)' : '#e5e7eb',
                fontSize: 'clamp(1.6rem, 8vw, 2.4rem)',
              }}
              placeholder="00"
            />
            <button onClick={callNum} disabled={gameOver}
              className="px-5 sm:px-8 h-14 sm:h-16 rounded-xl font-black text-white transition-all
                hover:opacity-90 active:scale-95 whitespace-nowrap shadow-md bebas tracking-widest
                disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background: 'var(--primary)',
                fontSize: 'clamp(1rem, 4vw, 1.4rem)',
              }}>
              CANTAR
            </button>
          </div>
          {gameError && <p className="text-red-500 text-sm mt-2 font-medium">{gameError}</p>}
          {gameOver && (
            <p className="text-center text-gray-400 text-sm mt-2">
              Partida terminada — toca <strong>✕</strong> para jugar otra vez.
            </p>
          )}
        </div>

        {/* ── Called balls ── */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs font-bold text-gray-400 mb-2 tracking-wider uppercase">
            Cantados — {called.length} / 75
          </p>
          <div ref={ballsRef}
            className="flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--primary-a35) transparent' }}>
            {called.length === 0
              ? <span className="text-gray-300 text-sm py-2 px-1 italic">Aún sin números…</span>
              : called.map((n, i) => {
                  const isLast = i === called.length - 1
                  return (
                    <div key={i}
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                        font-black bebas transition-all duration-200
                        ${isLast && rainbow ? 'is-rainbow' : ''}`}
                      style={{
                        background: isLast && !rainbow ? 'var(--primary)' : isLast ? undefined : '#f3f4f6',
                        color:      isLast ? '#fff' : '#4b5563',
                        transform:  isLast ? 'scale(1.22)' : 'scale(1)',
                        boxShadow:  isLast && !rainbow ? '0 3px 12px var(--primary-a35)' : 'none',
                        fontSize:   '1rem',
                      }}>
                      {n}
                    </div>
                  )
                })
            }
          </div>
        </div>

        {/* ── Game cards grid ──
              1 column on mobile, 2 on sm, 3 on xl                          */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4
          pb-20 sm:pb-0">  {/* bottom padding clears the FAB on mobile */}
          {gameCards.map(card => {
            const hasBadge = card.badges.length > 0
            return (
              <div key={card.id}
                className="bg-white rounded-2xl overflow-hidden transition-all duration-300"
                style={{
                  boxShadow: hasBadge
                    ? '0 0 0 3px var(--primary), 0 6px 24px var(--primary-a35)'
                    : '0 1px 4px rgba(0,0,0,0.08)',
                }}>

                {/* Card header */}
                <div className={`px-3 py-2.5 flex items-center gap-2 transition-colors duration-300
                  ${hasBadge && rainbow ? 'is-rainbow' : ''}`}
                  style={{
                    background:   hasBadge && !rainbow ? 'var(--primary)' :
                                  hasBadge &&  rainbow ? undefined         : '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                  }}>
                  <span className={`bebas tracking-wider text-sm flex-1
                    ${hasBadge ? 'text-white' : 'text-gray-700'}`}>
                    Cartón #{card.idx}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3].map(s => {
                      const { badge, emoji, label } = STAGES[s]
                      if (!card.badges.includes(badge)) return null
                      return <span key={s} className="text-base leading-none" title={label}>{emoji}</span>
                    })}
                    {!hasBadge && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                        Jugando
                      </span>
                    )}
                  </div>
                </div>

                {/* BINGO column labels */}
                <div className="grid grid-cols-5 bg-gray-50 border-b border-gray-100">
                  {COLS.map(l => (
                    <div key={l} className="text-center py-1 text-xs font-black bebas tracking-wider"
                      style={{ color: 'var(--primary)' }}>
                      {l}
                    </div>
                  ))}
                </div>

                {/* Cell grid */}
                <div className="grid grid-cols-5 gap-1 p-2 sm:gap-1.5 sm:p-2.5">
                  {card.numbers.map((row, r) => row.map((n, c) => {
                    const free        = isFree(r, c)
                    const marked      = card.marked[r][c]
                    const cellRainbow = (free || marked) && rainbow
                    return (
                      <button key={`${r}${c}`}
                        onClick={() => toggleCell(card.id, r, c)}
                        disabled={free}
                        className={`bingo-cell aspect-square rounded-lg flex items-center
                          justify-center font-bold
                          ${marked && !free ? 'marked' : ''}
                          ${cellRainbow ? 'is-rainbow' : ''}`}
                        style={{
                          background: (free || marked) && !rainbow ? 'var(--primary)' :
                                      (free || marked) &&  rainbow ? undefined         : '#f3f4f6',
                          color:      free || marked ? '#fff' : '#374151',
                          cursor:     free ? 'default' : 'pointer',
                          fontSize:   'clamp(0.6rem, 2.5vw, 0.8rem)',
                          boxShadow:  marked && !free && !rainbow
                            ? '0 2px 8px var(--primary-a35)' : 'none',
                        }}>
                        {free ? '★' : n}
                      </button>
                    )
                  }))}
                </div>

              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}
