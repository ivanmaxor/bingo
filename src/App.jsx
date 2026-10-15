import { useState, useEffect, useRef, useCallback } from 'react'
import {
  COLS, FREE, mkGrid, emptyForm, noManual, emptyPat,
  FIGURE_PRESETS, patFromPreset, PRIZE_EMOJI, defaultPrizes,
  cardMarked, formToNumbers, numbersToForm, sameNumbers, analyzeForm,
  missing, evaluate, winMessage, parseCardsText, AI_PROMPT,
} from './logic'

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
  } catch { /* audio not available */ }
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORE_KEY = 'bingo-v2'

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY))
    if (!s || typeof s !== 'object') return {}
    const okGrid = g => Array.isArray(g) && g.length === 5 && g.every(r => Array.isArray(r) && r.length === 5)
    if (!Array.isArray(s.cards) || !s.cards.every(c => okGrid(c?.numbers) && okGrid(c?.manual))) s.cards = []
    if (!Array.isArray(s.prizes) || !s.prizes.length) s.prizes = null
    if (!Array.isArray(s.called)) s.called = []
    if (!s.awards || typeof s.awards !== 'object') s.awards = {}
    return s
  } catch { return {} }
}

const S = loadSaved()

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

// ── Colors ────────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#7C3AED','#6D28D9','#4F46E5','#2563EB','#1D4ED8','#0284C7',
  '#0891B2','#0F766E','#059669','#16A34A','#65A30D','#CA8A04',
  '#D97706','#EA580C','#DC2626','#DB2777','#C026D3','#374151',
]

function syncCssColor(hex) {
  const v = hex.replace('#', '')
  const [R, G, B] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16))
  const d = document.documentElement.style
  d.setProperty('--primary',      `rgb(${R},${G},${B})`)
  d.setProperty('--primary-a35',  `rgba(${R},${G},${B},0.35)`)
  d.setProperty('--primary-a12',  `rgba(${R},${G},${B},0.12)`)
  d.setProperty('--primary-dark', `rgb(${Math.max(0,R-40)},${Math.max(0,G-40)},${Math.max(0,B-40)})`)
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Section({ title, children, right }) {
  return (
    <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm">
      {title && (
        <div className="flex items-center justify-between mb-3 gap-2">
          <p className="font-bold text-gray-500 text-xs uppercase tracking-wider">{title}</p>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

function ErrorBox({ children }) {
  return (
    <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm font-medium">
      {children}
    </div>
  )
}

const CELL_BORDER = { free: 'var(--primary)', ok: 'var(--primary)', warn: '#f59e0b', err: '#ef4444' }

const sanitizeCell = raw => {
  const v = raw.trim()
  if (/^[*★]$/.test(v) || (/[*★]/.test(v) && !/\d/.test(v))) return FREE
  return v.replace(/\D/g, '').slice(0, 2)
}

// Number catalog for one column (B 1-15, I 16-30, …): tap the right number to fill a cell.
function NumberPicker({ col, used, onPick, onFree, onClose }) {
  const nums = Array.from({ length: 15 }, (_, i) => col * 15 + 1 + i)
  return (
    <div className="mt-3 rounded-xl border-2 p-2" style={{ borderColor: 'var(--primary-a35)', background: 'var(--primary-a12)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold" style={{ color: 'var(--primary)' }}>
          Columna {COLS[col]} · toca el número correcto
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={onFree}
            className="px-2 py-1 rounded-lg bg-white text-xs font-bold text-gray-600 border border-gray-200">★ libre</button>
          <button type="button" onClick={onClose}
            className="px-2 py-1 rounded-lg bg-white text-xs font-bold text-gray-600 border border-gray-200">✕</button>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {nums.map(n => (
          <button key={n} type="button" disabled={used.has(n)} onClick={() => onPick(n)}
            className="h-10 rounded-lg bg-white font-bold text-sm border border-gray-200 active:scale-90
              transition-all disabled:opacity-25 disabled:line-through">
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

// 5×5 input grid. A "*" cell is a free space. In freeMode, tapping a cell toggles it free.
// Tapping a cell opens the column's number catalog (kbd=false hides the phone keyboard).
function CardFormGrid({ form, onChange, onSubmit, freeMode = false, status, kbd = true }) {
  const st = status || analyzeForm(form).st
  const [active, setActive] = useState(null)
  const used = new Set(form.flat().filter(v => /^\d+$/.test(v)).map(Number))
  if (active && /^\d+$/.test(form[active.r][active.c])) used.delete(Number(form[active.r][active.c]))
  const pick = v => { onChange(active.r, active.c, v); setActive(null) }
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="inline-block min-w-full">
        <div className="grid grid-cols-5 gap-1 mb-1">
          {COLS.map(l => (
            <div key={l} className="w-12 sm:w-14 text-center text-sm font-black bebas tracking-wider"
              style={{ color: 'var(--primary)' }}>{l}</div>
          ))}
        </div>
        <div className="grid grid-cols-5 gap-1">
          {mkGrid((r, c) => {
            const v = form[r][c]
            const base = 'w-12 sm:w-14 h-11 sm:h-12 rounded-xl'
            if (v === FREE) {
              return (
                <button key={`${r}${c}`} type="button" onClick={() => onChange(r, c, '')}
                  title="Espacio libre (toca para convertirlo en número)"
                  className={`${base} flex items-center justify-center text-white font-black bebas tracking-widest text-xs sm:text-sm`}
                  style={{ background: 'var(--primary)' }}>
                  FREE
                </button>
              )
            }
            if (freeMode) {
              return (
                <button key={`${r}${c}`} type="button" onClick={() => onChange(r, c, FREE)}
                  className={`${base} border-2 border-dashed font-bold text-base text-gray-500 bg-gray-50`}
                  style={{ borderColor: '#9ca3af' }}>
                  {v || '—'}
                </button>
              )
            }
            const s = st[r][c]
            const isActive = active && active.r === r && active.c === c
            return (
              <input key={`${r}${c}`} type="text" inputMode={kbd ? 'numeric' : 'none'} maxLength={2}
                value={v}
                onFocus={() => setActive({ r, c })}
                onChange={e => onChange(r, c, sanitizeCell(e.target.value))}
                onKeyDown={e => e.key === 'Enter' && onSubmit?.()}
                className={`${base} border-2 text-center font-bold text-base focus:outline-none transition-colors`}
                style={{
                  borderColor: isActive ? '#111827' : v ? CELL_BORDER[s] : '#e5e7eb',
                  background: s === 'err' && v ? '#fef2f2' : s === 'warn' ? '#fffbeb' : undefined,
                }}
                placeholder="—" />
            )
          }).flat()}
        </div>
        {active && !freeMode && form[active.r][active.c] !== FREE && (
          <NumberPicker col={active.c} used={used}
            onPick={n => pick(String(n))} onFree={() => pick(FREE)} onClose={() => setActive(null)} />
        )}
      </div>
    </div>
  )
}

function FreeModeToggle({ on, onToggle }) {
  return (
    <button type="button" onClick={onToggle}
      className={`mb-3 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all active:scale-95
        ${on ? 'text-white border-transparent' : 'border-gray-200 text-gray-500'}`}
      style={on ? { background: 'var(--primary)' } : undefined}>
      ★ Marcar espacios libres{on ? ' (activo: toca las casillas)' : ''}
    </button>
  )
}

// 30×30 px dot preview for figure preset buttons
function MiniPattern({ pattern }) {
  return (
    <div className="grid grid-cols-5 gap-px" style={{ width: 30, height: 30 }}>
      {mkGrid((r, c) => (
        <div key={`${r}${c}`} className="rounded-sm"
          style={{ background: pattern[r][c] ? 'var(--primary)' : '#d1d5db' }} />
      )).flat()}
    </div>
  )
}

function PatternEditor({ pattern, onChange }) {
  const toggle = (r, c) => onChange(pattern.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))))
  return (
    <div className="inline-block">
      <div className="grid grid-cols-5 gap-1 mb-1">
        {COLS.map(l => (
          <div key={l} className="w-11 text-center text-xs font-black bebas tracking-wider"
            style={{ color: 'var(--primary)' }}>{l}</div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {mkGrid((r, c) => (
          <button key={`${r}${c}`} type="button" onClick={() => toggle(r, c)}
            className="bingo-cell w-11 h-11 rounded-xl text-sm font-bold"
            style={{
              background: pattern[r][c] ? 'var(--primary)' : '#e5e7eb',
              color:      pattern[r][c] ? '#fff' : '#9ca3af',
              boxShadow:  pattern[r][c] ? '0 2px 8px var(--primary-a35)' : 'none',
              transform:  pattern[r][c] ? 'scale(1.07)' : 'scale(1)',
            }}>
            {pattern[r][c] ? '✓' : (r === 2 && c === 2 ? '★' : '·')}
          </button>
        )).flat()}
      </div>
    </div>
  )
}

// Add / edit one card in a bottom-sheet modal.
function CardModal({ title, form, setForm, error, onSave, onClose, onDelete, note, saveLabel }) {
  const [freeMode, setFreeMode] = useState(false)
  const update = (r, c, v) => setForm(f => f.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? v : x))))
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-sm p-5 sm:p-6 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4 sm:hidden" />
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-800">{title}</h2>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500
              flex items-center justify-center font-bold text-lg leading-none transition-colors">×</button>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <FreeModeToggle on={freeMode} onToggle={() => setFreeMode(m => !m)} />
        <CardFormGrid form={form} onChange={update} onSubmit={onSave} freeMode={freeMode} kbd={false} />
        {note && <p className="text-xs text-gray-400 mt-2">{note}</p>}
        <div className="flex gap-2 mt-4">
          {onDelete && (
            <button onClick={onDelete}
              className="px-4 py-3 rounded-xl border-2 border-red-200 text-red-500 font-bold text-sm
                hover:bg-red-50 active:scale-95 transition-all">Eliminar</button>
          )}
          <button onClick={onClose}
            className="flex-1 py-3 rounded-xl border-2 border-gray-200 text-gray-500 font-bold text-sm
              hover:border-gray-300 active:scale-95 transition-all">Cancelar</button>
          <button onClick={onSave}
            className="flex-1 py-3 rounded-xl text-white font-bold text-sm hover:opacity-90
              active:scale-95 transition-all shadow-md"
            style={{ background: 'var(--primary)' }}>{saveLabel}</button>
        </div>
      </div>
    </div>
  )
}

// Called-number board ordered by letter: tap a number to call it.
function CallBoard({ called, onCall, disabled }) {
  const set = new Set(called)
  const last = called[called.length - 1]
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {COLS.map((l, ci) => (
        <div key={l} className="flex flex-col gap-1">
          <div className="text-center text-sm font-black bebas tracking-wider" style={{ color: 'var(--primary)' }}>{l}</div>
          {Array.from({ length: 15 }, (_, i) => ci * 15 + 1 + i).map(n => {
            const on = set.has(n)
            return (
              <button key={n} type="button" onClick={() => onCall(n)} disabled={disabled || on}
                className="h-8 rounded-md text-xs font-bold transition-all active:scale-90 disabled:cursor-default"
                style={{
                  background: n === last ? 'var(--primary)' : on ? 'var(--primary-a35)' : '#f3f4f6',
                  color: n === last ? '#fff' : on ? 'var(--primary-dark)' : '#374151',
                }}>
                {n}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [color,   setColor]   = useState(S.color || '#7C3AED')
  const [rainbow, setRainbow] = useState(!!S.rainbow)
  const [prizes,  setPrizes]  = useState(S.prizes || defaultPrizes())
  const [cards,   setCards]   = useState(S.cards || [])
  const [started, setStarted] = useState(!!S.started && (S.cards || []).length > 0)
  const [called,  setCalled]  = useState(S.called || [])
  const [awards,  setAwards]  = useState(S.awards || {})

  // Config: manual add + import
  const [form,       setForm]       = useState(emptyForm)
  const [freeMode,   setFreeMode]   = useState(false)
  const [cardError,  setCardError]  = useState('')
  const [importText, setImportText] = useState('')
  const [drafts,     setDrafts]     = useState([])
  const [importMsg,  setImportMsg]  = useState('')
  const [copied,     setCopied]     = useState(false)
  const [startError, setStartError] = useState('')

  // Game
  const [numInput,  setNumInput]  = useState('')
  const [gameError, setGameError] = useState('')
  const [toast,     setToast]     = useState(null)
  const [showBoard, setShowBoard] = useState(S.showBoard !== false)
  const [onlyNear,  setOnlyNear]  = useState(false)
  const [nearN,     setNearN]     = useState(2)

  // Card modal: { mode: 'add' | 'edit', id? }
  const [modal,      setModal]      = useState(null)
  const [modalForm,  setModalForm]  = useState(emptyForm)
  const [modalError, setModalError] = useState('')

  const inputRef   = useRef(null)
  const ballsRef   = useRef(null)
  const toastTimer = useRef([])

  useEffect(() => { syncCssColor(color) }, [color])
  useEffect(() => { loadConfetti() }, [])
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ color, rainbow, prizes, cards, started, called, awards, showBoard }))
    } catch { /* storage full or blocked */ }
  }, [color, rainbow, prizes, cards, started, called, awards, showBoard])

  const gameOver = started && prizes.length > 0 && prizes.every(p => awards[p.id])

  // ── Prize editor ──────────────────────────────────────────────────────────

  const patchPrize = (id, patch) => setPrizes(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)))
  const movePrize = (i, d) => setPrizes(ps => {
    const j = i + d
    if (j < 0 || j >= ps.length) return ps
    const n = [...ps]; [n[i], n[j]] = [n[j], n[i]]; return n
  })
  const addPrize = type => setPrizes(ps => [...ps, {
    id: newId(), type,
    name: type === 'line' ? 'Línea' : type === 'full' ? 'Cartón lleno' : 'Mi figura',
    ...(type === 'line' ? { dirs: 'any' } : {}),
    ...(type === 'figure' ? { pattern: emptyPat() } : {}),
  }])

  // ── Add cards (manual / import) ───────────────────────────────────────────

  const makeCard = f => ({ id: newId(), numbers: formToNumbers(f), manual: noManual() })

  const updateForm = (r, c, v) =>
    setForm(f => f.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? v : x))))

  const addCard = () => {
    const a = analyzeForm(form)
    if (!a.valid) { setCardError(a.errors.join(' · ')); return }
    setCardError('')
    setCards(prev => [...prev, makeCard(form)])
    setForm(emptyForm())
  }

  const readImport = () => {
    const parsed = parseCardsText(importText)
    if (!parsed.length) { setImportMsg('No encontré ningún cartón en el texto.'); setDrafts([]); return }
    setImportMsg('')
    setDrafts(parsed.map(p => ({ key: newId(), form: p.form, note: p.note })))
  }

  const updateDraft = (key, r, c, v) =>
    setDrafts(ds => ds.map(d => d.key !== key ? d : {
      ...d, form: d.form.map((row, ri) => row.map((x, ci) => (ri === r && ci === c ? v : x))),
    }))
  const removeDraft = key => setDrafts(ds => ds.filter(d => d.key !== key))

  const draftInfo = (d, i) => {
    const a = analyzeForm(d.form)
    const nums = formToNumbers(d.form)
    const dupExisting = a.valid && cards.some(c => sameNumbers(c.numbers, nums))
    const dupDraft = a.valid && drafts.some((o, j) => j < i && analyzeForm(o.form).valid && sameNumbers(formToNumbers(o.form), nums))
    return { ...a, dupExisting, dupDraft }
  }

  const confirmDrafts = keys => {
    const toAdd = drafts.filter(d => keys.includes(d.key) && analyzeForm(d.form).valid)
    if (!toAdd.length) return
    setCards(prev => [...prev, ...toAdd.map(d => makeCard(d.form))])
    setDrafts(ds => ds.filter(d => !toAdd.some(a => a.key === d.key)))
    if (toAdd.length === drafts.length) setImportText('')
  }

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(AI_PROMPT) } catch {
      const t = document.createElement('textarea'); t.value = AI_PROMPT
      document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // ── Start / reset ─────────────────────────────────────────────────────────

  const startGame = () => {
    if (!cards.length) return
    if (!prizes.length) { setStartError('Agrega al menos un premio'); return }
    const bad = prizes.find(p => p.type === 'figure' && !p.pattern.flat().some(Boolean))
    if (bad) { setStartError(`La figura «${bad.name}» no tiene casillas marcadas`); return }
    setStartError('')
    setCards(cs => cs.map(c => ({ ...c, manual: noManual() })))
    setCalled([]); setAwards({}); setNumInput(''); setGameError(''); setToast(null)
    setStarted(true)
  }

  const clearToasts = () => { toastTimer.current.forEach(clearTimeout); toastTimer.current = []; setToast(null) }

  const backToConfig = () => {
    clearToasts()
    setStarted(false); setCalled([]); setAwards({}); setNumInput(''); setGameError('')
    setCards(cs => cs.map(c => ({ ...c, manual: noManual() })))
  }

  const clearAllCards = () => {
    if (cards.length && !window.confirm(`¿Borrar los ${cards.length} cartones?`)) return
    setCards([])
  }

  // ── Announcements ─────────────────────────────────────────────────────────

  const announce = useCallback((freshIds, newAwards, cardsNow, calledNow) => {
    toastTimer.current.forEach(clearTimeout); toastTimer.current = []
    freshIds.forEach((id, i) => {
      const p = prizes.find(x => x.id === id)
      if (!p) return
      const msg = winMessage(p, newAwards[id].cardIds, cardsNow, calledNow)
      toastTimer.current.push(setTimeout(() => {
        setToast({ msg })
        playWinSound()
        loadConfetti().then(f => f && f({ particleCount: 230, spread: 110, origin: { y: 0.55 } }))
      }, i * 4200))
    })
    if (freshIds.length) {
      toastTimer.current.push(setTimeout(() => setToast(null), (freshIds.length - 1) * 4200 + 4000))
    }
  }, [prizes])

  // Re-evaluates prizes after any change and announces new ones.
  const commit = useCallback((nextCards, nextCalled, baseAwards, viaCall = false) => {
    const { awards: na, fresh } = evaluate(nextCards, nextCalled, baseAwards, prizes, viaCall)
    setCards(nextCards); setCalled(nextCalled); setAwards(na)
    announce(fresh, na, nextCards, nextCalled)
  }, [prizes, announce])

  // ── Game actions ──────────────────────────────────────────────────────────

  const callValue = n => {
    if (gameOver) return
    if (isNaN(n) || n < 1 || n > 75) { setGameError('Número entre 1 y 75'); return }
    if (called.includes(n))           { setGameError(`El ${n} ya fue cantado`); return }
    setGameError(''); setNumInput('')
    commit(cards, [...called, n], awards, true)
    setTimeout(() => {
      if (ballsRef.current) ballsRef.current.scrollLeft = ballsRef.current.scrollWidth
    }, 40)
  }
  const callNum = () => { callValue(parseInt(numInput, 10)); inputRef.current?.focus() }

  const undoLast = () => {
    if (!called.length) return
    clearToasts()
    const nc = called.slice(0, -1)
    const kept = {}
    for (const [k, v] of Object.entries(awards)) if (v.step <= nc.length) kept[k] = v
    commit(cards, nc, kept)
  }

  // Someone else already won this prize: it stops counting for my cards (undoable).
  const markTaken = p => {
    const nextAwards = { ...awards, [p.id]: { step: -1, cardIds: [], last: null, external: true } }
    setAwards(nextAwards)
  }
  const unmarkTaken = p => {
    const rest = { ...awards }; delete rest[p.id]
    commit(cards, called, rest)
  }

  const toggleCell = (cardId, r, c) => {
    if (gameOver) return
    const next = cards.map(card => card.id !== cardId || card.numbers[r][c] === null ? card : {
      ...card,
      manual: card.manual.map((row, ri) => row.map((v, ci) => (ri === r && ci === c ? !v : v))),
    })
    commit(next, called, awards)
  }

  // ── Card modal ────────────────────────────────────────────────────────────

  const openAdd = () => { setModalForm(emptyForm()); setModalError(''); setModal({ mode: 'add' }) }
  const openEdit = card => {
    setModalForm(numbersToForm(card.numbers)); setModalError(''); setModal({ mode: 'edit', id: card.id })
  }

  const saveModal = () => {
    const a = analyzeForm(modalForm)
    if (!a.valid) { setModalError(a.errors.join(' · ')); return }
    const numbers = formToNumbers(modalForm)
    const next = modal.mode === 'add'
      ? [...cards, { id: newId(), numbers, manual: noManual() }]
      : cards.map(c => (c.id === modal.id ? { ...c, numbers, manual: noManual() } : c))
    if (started) commit(next, called, awards)
    else setCards(next)
    setModal(null)
  }

  const deleteModal = () => {
    if (!window.confirm('¿Eliminar este cartón?')) return
    const next = cards.filter(c => c.id !== modal.id)
    if (started) commit(next, called, awards)
    else setCards(next)
    setModal(null)
  }

  const cardModal = modal && (
    <CardModal
      title={modal.mode === 'add' ? 'Agregar cartón' : `Editar cartón #${cards.findIndex(c => c.id === modal.id) + 1}`}
      form={modalForm} setForm={setModalForm} error={modalError}
      onSave={saveModal} onClose={() => setModal(null)}
      onDelete={modal.mode === 'edit' ? deleteModal : undefined}
      saveLabel={modal.mode === 'add' ? '+ Agregar' : 'Guardar'}
      note={started && called.length > 0
        ? `${called.length} número(s) ya cantados se marcarán automáticamente.` : undefined}
    />
  )

  // ══════════════════════════════════════════════════════════════════════════
  //  CONFIG SCREEN
  // ══════════════════════════════════════════════════════════════════════════

  if (!started) {
    const draftValid = drafts.filter(d => analyzeForm(d.form).valid)
    return (
      <div className="min-h-screen bg-gray-50 pb-12">
        {cardModal}

        <header className={`text-white text-center py-8 sm:py-10 mb-5 shadow-xl ${rainbow ? 'is-rainbow' : ''}`}
          style={{ background: rainbow ? undefined : 'var(--primary)' }}>
          <h1 className="bebas text-6xl sm:text-7xl text-white select-none drop-shadow-lg"
            style={{ letterSpacing: '0.35em' }}>BINGO</h1>
          <p className="text-xs opacity-60 tracking-[0.2em] uppercase mt-1 font-medium">
            Configuración de partida
          </p>
        </header>

        <div className="max-w-xl mx-auto px-3 sm:px-4 space-y-4">

          {/* ── Color ── */}
          <Section title="Color primario">
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
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
                <button onClick={() => setRainbow(r => !r)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-sm font-bold
                    transition-all hover:scale-105 active:scale-95 select-none flex-shrink-0
                    ${rainbow ? 'is-rainbow text-white border-transparent' : 'border-gray-200 text-gray-500'}`}>
                  🌈 Arcoíris{rainbow ? ' ✓' : ''}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map(c => (
                  <button key={c} onClick={() => { setColor(c); setRainbow(false) }}
                    className="w-8 h-8 rounded-full transition-all hover:scale-110 active:scale-95 shadow-sm"
                    style={{
                      background: c,
                      outline: !rainbow && c === color ? `3px solid ${c}` : 'none',
                      outlineOffset: '2px',
                    }} />
                ))}
              </div>
            </div>
          </Section>

          {/* ── Prizes ── */}
          <Section title="Premios de la partida">
            <p className="text-xs text-gray-400 mb-3">
              Cada premio se gana la primera vez que algún cartón lo completa, en cualquier orden.
              Los espacios libres (★) de cada cartón cuentan como ya marcados.
            </p>
            <div className="space-y-3">
              {prizes.map((p, i) => (
                <div key={p.id} className="rounded-xl border-2 p-3" style={{ borderColor: 'var(--primary-a35)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl flex-shrink-0">{PRIZE_EMOJI[p.type]}</span>
                    <input type="text" value={p.name} maxLength={28}
                      onChange={e => patchPrize(p.id, { name: e.target.value })}
                      className="flex-1 min-w-0 h-10 px-3 rounded-lg border-2 border-gray-200 font-bold text-sm
                        focus:outline-none" style={{ fontSize: 16 }} />
                    <button onClick={() => movePrize(i, -1)} disabled={i === 0}
                      className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 font-bold disabled:opacity-30">↑</button>
                    <button onClick={() => movePrize(i, 1)} disabled={i === prizes.length - 1}
                      className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 font-bold disabled:opacity-30">↓</button>
                    <button onClick={() => setPrizes(ps => ps.filter(x => x.id !== p.id))}
                      className="w-8 h-8 rounded-lg bg-red-50 text-red-500 font-bold">×</button>
                  </div>

                  {p.type === 'line' && (
                    <div className="mt-2 flex gap-2 text-xs font-bold">
                      {[['any', 'Fila, columna o diagonal'], ['rows', 'Solo filas']].map(([v, label]) => (
                        <button key={v} onClick={() => patchPrize(p.id, { dirs: v })}
                          className={`px-3 py-1.5 rounded-lg border-2 transition-all
                            ${p.dirs === v ? 'text-white border-transparent' : 'border-gray-200 text-gray-500'}`}
                          style={p.dirs === v ? { background: 'var(--primary)' } : undefined}>{label}</button>
                      ))}
                    </div>
                  )}
                  {p.type === 'full' && (
                    <p className="text-xs text-gray-400 mt-2">Todas las casillas del cartón marcadas.</p>
                  )}
                  {p.type === 'figure' && (
                    <div className="mt-3">
                      <div className="flex flex-wrap gap-2 mb-3">
                        {Object.keys(FIGURE_PRESETS).map(name => (
                          <button key={name}
                            onClick={() => patchPrize(p.id, { pattern: patFromPreset(name), name })}
                            className="flex flex-col items-center gap-1 px-2.5 pt-2 pb-1.5 rounded-xl border-2
                              transition-all hover:shadow-md active:scale-95"
                            style={{ borderColor: 'var(--primary-a35)' }}>
                            <MiniPattern pattern={patFromPreset(name)} />
                            <span className="text-[10px] font-black bebas tracking-wider"
                              style={{ color: 'var(--primary)' }}>{name}</span>
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mb-2">Elige una figura o dibuja la tuya tocando las casillas.</p>
                      <PatternEditor pattern={p.pattern} onChange={pattern => patchPrize(p.id, { pattern })} />
                      <p className="text-xs text-gray-400 mt-2">
                        {p.pattern.flat().filter(Boolean).length} casilla(s) seleccionada(s)
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {[['line', '+ Línea'], ['figure', '+ Figura'], ['full', '+ Cartón lleno']].map(([t, label]) => (
                <button key={t} onClick={() => addPrize(t)}
                  className="px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all active:scale-95"
                  style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>{label}</button>
              ))}
            </div>
          </Section>

          {/* ── Import ── */}
          <Section title="Importar cartones desde texto">
            <p className="text-xs text-gray-500 mb-3">
              Pásale las fotos de tus cartones (máx. 10 por vez) a una IA con el prompt de abajo, pega aquí su
              respuesta y revisa cada cartón antes de agregarlo.
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              <button onClick={copyPrompt}
                className="px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all active:scale-95"
                style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}>
                {copied ? '✓ Copiado' : '📋 Copiar prompt para la IA'}
              </button>
            </div>
            <textarea value={importText} onChange={e => setImportText(e.target.value)} rows={7}
              placeholder={'5 20 38 52 70\n12 19 41 48 66\n3 27 * 55 61\n9 16 33 47 74\n1 22 44 59 68\n\n(línea en blanco entre cartones)'}
              className="w-full rounded-xl border-2 border-gray-200 p-3 font-mono text-sm focus:outline-none"
              style={{ fontSize: 16 }} />
            {importMsg && <p className="text-red-500 text-sm mt-2 font-medium">{importMsg}</p>}
            <button onClick={readImport} disabled={!importText.trim()}
              className="mt-3 w-full py-3 rounded-xl font-bold text-white text-sm transition-all
                hover:opacity-90 active:scale-95 shadow-md disabled:opacity-40"
              style={{ background: 'var(--primary)' }}>
              Leer texto
            </button>

            {drafts.length > 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-gray-700">
                    {drafts.length} cartón(es) leído(s) — revísalos
                  </p>
                  <button onClick={() => setDrafts([])} className="text-xs font-bold text-gray-400 underline">
                    Descartar todo
                  </button>
                </div>
                {drafts.map((d, i) => {
                  const info = draftInfo(d, i)
                  const state = !info.valid ? 'err' : (info.warns || info.dupExisting || info.dupDraft) ? 'warn' : 'ok'
                  return (
                    <div key={d.key} className="rounded-xl border-2 p-3"
                      style={{ borderColor: state === 'err' ? '#fca5a5' : state === 'warn' ? '#fcd34d' : 'var(--primary-a35)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bebas tracking-wider text-sm flex-1" style={{ color: 'var(--primary)' }}>
                          Cartón leído #{i + 1}
                        </span>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                          ${state === 'err' ? 'bg-red-100 text-red-600' : state === 'warn' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                          {state === 'err' ? '✗ corregir' : state === 'warn' ? '⚠ revisar' : '✓ listo'}
                        </span>
                      </div>
                      <CardFormGrid form={d.form} status={info.st} kbd={false}
                        onChange={(r, c, v) => updateDraft(d.key, r, c, v)} />
                      <div className="mt-2 space-y-0.5 text-xs">
                        {info.errors.map(e => <p key={e} className="text-red-500 font-medium">✗ {e}</p>)}
                        {d.note && <p className="text-red-500 font-medium">✗ {d.note}</p>}
                        {info.warns > 0 && (
                          <p className="text-amber-600">⚠ {info.warns} número(s) fuera del rango de su columna
                            (B 1-15, I 16-30, N 31-45, G 46-60, O 61-75): puede ser una lectura equivocada.</p>
                        )}
                        {info.dupExisting && <p className="text-amber-600">⚠ Ya tienes un cartón idéntico agregado.</p>}
                        {info.dupDraft && <p className="text-amber-600">⚠ Es igual a otro cartón de esta lista.</p>}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => removeDraft(d.key)}
                          className="px-4 py-2 rounded-xl border-2 border-gray-200 text-gray-500 font-bold text-sm
                            active:scale-95 transition-all">Quitar</button>
                        <button onClick={() => confirmDrafts([d.key])} disabled={!info.valid}
                          className="flex-1 py-2 rounded-xl text-white font-bold text-sm active:scale-95
                            transition-all shadow-md disabled:opacity-40"
                          style={{ background: 'var(--primary)' }}>
                          ✓ Confirmar este cartón
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button onClick={() => confirmDrafts(drafts.map(d => d.key))} disabled={!draftValid.length}
                  className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all
                    hover:opacity-90 active:scale-95 shadow-md disabled:opacity-40"
                  style={{ background: 'var(--primary)' }}>
                  Agregar todos los válidos ({draftValid.length})
                </button>
              </div>
            )}
          </Section>

          {/* ── Manual card ── */}
          <Section title="Agregar cartón a mano">
            {cardError && <ErrorBox>{cardError}</ErrorBox>}
            <FreeModeToggle on={freeMode} onToggle={() => setFreeMode(m => !m)} />
            <CardFormGrid form={form} onChange={updateForm} onSubmit={addCard} freeMode={freeMode} />
            <button onClick={addCard}
              className="mt-4 w-full py-3 rounded-xl font-bold text-white text-sm
                transition-all hover:opacity-90 active:scale-95 shadow-md"
              style={{ background: 'var(--primary)' }}>
              + Agregar cartón
            </button>
          </Section>

          {/* ── Cards ── */}
          {cards.length > 0 && (
            <Section title={`Cartones (${cards.length})`}
              right={<button onClick={clearAllCards} className="text-xs font-bold text-red-400 underline">Borrar todos</button>}>
              <p className="text-xs text-gray-400 mb-3">Toca un cartón para corregir sus números.</p>
              <div className="flex flex-wrap gap-3">
                {cards.map((card, i) => (
                  <div key={card.id} className="relative">
                    <button onClick={() => openEdit(card)}
                      className="border-2 rounded-xl p-2 transition-shadow hover:shadow-md bg-white"
                      style={{ borderColor: 'var(--primary-a35)' }}>
                      <p className="text-center text-xs font-black mb-1 bebas tracking-wider"
                        style={{ color: 'var(--primary)' }}>#{i + 1}</p>
                      <div className="grid grid-cols-5 gap-px">
                        {card.numbers.map((row, r) => row.map((n, c) => (
                          <div key={`${r}${c}`} className="w-6 h-5 flex items-center justify-center rounded"
                            style={{
                              background: n === null ? 'var(--primary)' : '#f3f4f6',
                              color: n === null ? '#fff' : '#374151',
                              fontSize: '8px', fontWeight: 700,
                            }}>
                            {n === null ? '★' : n}
                          </div>
                        ))).flat()}
                      </div>
                    </button>
                    <button onClick={() => setCards(prev => prev.filter(cc => cc.id !== card.id))}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white font-bold
                        flex items-center justify-center leading-none shadow-md hover:bg-red-600
                        transition-colors text-sm">×</button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {startError && <ErrorBox>{startError}</ErrorBox>}
          <button onClick={startGame} disabled={cards.length === 0}
            className="w-full py-4 rounded-2xl text-white shadow-lg transition-all hover:shadow-xl
              hover:opacity-95 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed bebas tracking-widest"
            style={{ background: 'var(--primary)', fontSize: '1.5rem' }}>
            INICIAR PARTIDA →
          </button>
          {cards.length === 0 && (
            <p className="text-center text-gray-400 text-xs -mt-2">Agrega al menos un cartón para comenzar</p>
          )}
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  GAME SCREEN
  // ══════════════════════════════════════════════════════════════════════════

  const calledSet = new Set(called)
  const marks = cards.map(c => cardMarked(c, calledSet))
  const idxOf = id => cards.findIndex(c => c.id === id) + 1
  const closest = i => {
    const ms = prizes.filter(p => !awards[p.id]).map(p => missing(p, marks[i])).filter(m => m > 0)
    return ms.length ? Math.min(...ms) : Infinity
  }
  const shownIdx = cards.map((_, i) => i)
    .filter(i => !onlyNear || closest(i) <= nearN)
    .sort((a, b) => (onlyNear ? closest(a) - closest(b) || a - b : 0))

  return (
    <div className="min-h-screen bg-gray-100">

      {toast && (
        <div className={`fixed top-4 left-1/2 z-50 bebas tracking-wider text-white
          px-6 py-3 rounded-2xl shadow-2xl text-center pointer-events-none toast-enter
          whitespace-pre-line ${rainbow ? 'is-rainbow' : ''}`}
          style={{
            maxWidth: '92vw', fontSize: 'clamp(1.1rem, 5vw, 1.6rem)', lineHeight: 1.2,
            background: rainbow ? undefined : 'var(--primary)',
            transform: 'translateX(-50%)',
          }}>
          {toast.msg}
        </div>
      )}

      {cardModal}

      <header className={`text-white shadow-lg ${rainbow ? 'is-rainbow' : ''}`}
        style={{ background: rainbow ? undefined : 'var(--primary)' }}>
        <div className="px-3 sm:px-4 pt-3 pb-1.5 flex items-center gap-1.5 sm:gap-2">
          <h1 className="bebas text-2xl sm:text-3xl text-white flex-1 select-none" style={{ letterSpacing: '0.2em' }}>
            BINGO
          </h1>
          <button onClick={openAdd}
            className="hidden sm:flex px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20
              hover:bg-white/30 transition-all active:scale-95 whitespace-nowrap">+ Cartón</button>
          <button onClick={undoLast} disabled={!called.length}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30
              disabled:opacity-40 transition-all active:scale-95 whitespace-nowrap">
            ↩<span className="hidden sm:inline"> Deshacer</span>
          </button>
          <button onClick={() => { if (window.confirm('¿Terminar la partida y volver a la configuración? Se conservan los cartones.')) backToConfig() }}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30
              transition-all active:scale-95 whitespace-nowrap">
            ✕<span className="hidden sm:inline"> Nueva</span>
          </button>
        </div>

        {/* Prize pills */}
        <div className="px-3 sm:px-4 pb-3 flex items-center gap-1.5 flex-wrap">
          {prizes.map(p => {
            const done = !!awards[p.id]
            return (
              <div key={p.id}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold select-none
                  ${done ? 'bg-white/30 text-white/90' : 'bg-white text-gray-800 shadow-md'}`}>
                <span>{PRIZE_EMOJI[p.type]}</span>
                <span>{p.name}</span>
                {done ? <span className="opacity-80">✓</span>
                      : <span className="w-1.5 h-1.5 rounded-full bg-green-400 pulse-dot inline-block" />}
              </div>
            )
          })}
          {gameOver && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-400 text-yellow-900 ml-1">🎊 ¡Fin!</span>
          )}
        </div>
      </header>

      {!gameOver && (
        <button onClick={openAdd}
          className="fixed bottom-5 right-4 z-30 sm:hidden w-14 h-14 rounded-full text-white text-3xl
            font-bold flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
          style={{ background: 'var(--primary)' }} aria-label="Agregar cartón">+</button>
      )}

      <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3 sm:space-y-4">

        {/* Number input */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <div className="flex gap-2 sm:gap-3">
            <input ref={inputRef} type="number" min="1" max="75" inputMode="numeric"
              value={numInput} onChange={e => setNumInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && callNum()}
              disabled={gameOver}
              className="flex-1 h-14 sm:h-16 rounded-xl border-2 text-center font-black focus:outline-none
                transition-colors bebas tracking-widest disabled:bg-gray-50 disabled:text-gray-300"
              style={{ borderColor: numInput ? 'var(--primary)' : '#e5e7eb', fontSize: 'clamp(1.6rem, 8vw, 2.4rem)' }}
              placeholder="00" />
            <button onClick={callNum} disabled={gameOver}
              className="px-5 sm:px-8 h-14 sm:h-16 rounded-xl font-black text-white transition-all
                hover:opacity-90 active:scale-95 whitespace-nowrap shadow-md bebas tracking-widest
                disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{ background: 'var(--primary)', fontSize: 'clamp(1rem, 4vw, 1.4rem)' }}>
              CANTAR
            </button>
          </div>
          {gameError && <p className="text-red-500 text-sm mt-2 font-medium">{gameError}</p>}
          {gameOver && (
            <p className="text-center text-gray-400 text-sm mt-2">
              Todos los premios entregados — toca <strong>✕</strong> para jugar otra vez (↩ para deshacer el último número).
            </p>
          )}
        </div>

        {/* Letter board */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <button onClick={() => setShowBoard(v => !v)}
            className="w-full flex items-center justify-between text-xs font-bold text-gray-400 tracking-wider uppercase">
            <span>Tablero B-I-N-G-O · toca para cantar</span>
            <span>{showBoard ? '▲ ocultar' : '▼ mostrar'}</span>
          </button>
          {showBoard && (
            <div className="mt-3">
              <CallBoard called={called} onCall={callValue} disabled={gameOver} />
            </div>
          )}
        </div>

        {/* Prize status */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs font-bold text-gray-400 mb-2 tracking-wider uppercase">Premios</p>
          <div className="space-y-1.5">
            {prizes.map(p => {
              const a = awards[p.id]
              let near = null
              if (!a) {
                const m = marks.map((mk, i) => ({ i, m: missing(p, mk) })).filter(x => x.m > 0)
                if (m.length) {
                  const best = Math.min(...m.map(x => x.m))
                  near = `Más cerca: cartón${m.filter(x => x.m === best).length > 1 ? 'es' : ''} ${
                    m.filter(x => x.m === best).map(x => '#' + (x.i + 1)).join(', ')} (${best === 1 ? 'falta 1' : `faltan ${best}`})`
                }
              }
              return (
                <div key={p.id} className="flex items-start gap-2 text-sm">
                  <span className="flex-shrink-0">{PRIZE_EMOJI[p.type]}</span>
                  <span className="font-bold text-gray-700 flex-shrink-0">{p.name}:</span>
                  <span className="flex-1 min-w-0">
                    {a?.external ? (
                      <span className="text-gray-500 font-semibold">✓ Ya lo ganó otra persona <span className="font-normal text-gray-400">(no cuenta)</span></span>
                    ) : a ? (
                      <span className="text-green-600 font-semibold">
                        ✓ {a.cardIds.length > 1 ? 'Cartones' : 'Cartón'} {a.cardIds.map(id => '#' + idxOf(id)).filter(s => s !== '#0').join(', ')}
                        {a.last !== null && <span className="text-gray-400 font-normal"> · con el {a.last}</span>}
                      </span>
                    ) : (
                      <span className="text-gray-400">pendiente{near ? ` · ${near}` : ''}</span>
                    )}
                  </span>
                  {a?.external && (
                    <button onClick={() => unmarkTaken(p)}
                      className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg border border-gray-300 text-gray-500">Quitar marca</button>
                  )}
                  {!a && !gameOver && (
                    <button onClick={() => markTaken(p)}
                      className="flex-shrink-0 text-xs font-bold px-2 py-0.5 rounded-lg border border-amber-300 text-amber-700 bg-amber-50">
                      Ya lo ganó otro
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Called balls */}
        <div className="bg-white rounded-2xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs font-bold text-gray-400 mb-2 tracking-wider uppercase">
            Cantados — {called.length} / 75
          </p>
          <div ref={ballsRef} className="flex gap-2 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--primary-a35) transparent' }}>
            {called.length === 0
              ? <span className="text-gray-300 text-sm py-2 px-1 italic">Aún sin números…</span>
              : called.map((n, i) => {
                  const isLast = i === called.length - 1
                  return (
                    <div key={i}
                      className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center
                        font-black bebas transition-all duration-200 ${isLast && rainbow ? 'is-rainbow' : ''}`}
                      style={{
                        background: isLast && !rainbow ? 'var(--primary)' : isLast ? undefined : '#f3f4f6',
                        color: isLast ? '#fff' : '#4b5563',
                        transform: isLast ? 'scale(1.22)' : 'scale(1)',
                        boxShadow: isLast && !rainbow ? '0 3px 12px var(--primary-a35)' : 'none',
                        fontSize: '1rem',
                      }}>
                      {n}
                    </div>
                  )
                })}
          </div>
        </div>

        {/* Card filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setOnlyNear(v => !v)}
            className={`px-3 py-2 rounded-xl border-2 text-sm font-bold transition-all active:scale-95
              ${onlyNear ? 'text-white border-transparent' : 'border-gray-200 text-gray-500 bg-white'}`}
            style={onlyNear ? { background: 'var(--primary)' } : undefined}>
            🎯 Solo cercanos{onlyNear ? ` (${shownIdx.length})` : ''}
          </button>
          <div className="flex items-center gap-1 text-xs font-bold text-gray-400">
            faltan ≤
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => setNearN(n)}
                className={`w-7 h-7 rounded-lg border-2 ${nearN === n ? 'text-white border-transparent' : 'border-gray-200 text-gray-500 bg-white'}`}
                style={nearN === n ? { background: 'var(--primary)' } : undefined}>{n}</button>
            ))}
          </div>
          {onlyNear && shownIdx.length === 0 && (
            <span className="text-xs text-gray-400">Ningún cartón está tan cerca todavía.</span>
          )}
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 pb-20 sm:pb-0">
          {shownIdx.map(ci => {
            const card = cards[ci]
            const mk = marks[ci]
            const wonPrizes = prizes.filter(p => awards[p.id]?.cardIds.includes(card.id))
            const hasBadge = wonPrizes.length > 0
            const near = prizes
              .filter(p => !awards[p.id])
              .map(p => ({ p, m: missing(p, mk) }))
              .filter(x => x.m > 0 && x.m <= nearN)
            return (
              <div key={card.id} className="bg-white rounded-2xl overflow-hidden transition-all duration-300"
                style={{
                  boxShadow: hasBadge
                    ? '0 0 0 3px var(--primary), 0 6px 24px var(--primary-a35)'
                    : '0 1px 4px rgba(0,0,0,0.08)',
                }}>
                <div className={`px-3 py-2.5 flex items-center gap-2 transition-colors duration-300
                  ${hasBadge && rainbow ? 'is-rainbow' : ''}`}
                  style={{
                    background: hasBadge && !rainbow ? 'var(--primary)' : hasBadge && rainbow ? undefined : '#f9fafb',
                    borderBottom: '1px solid #e5e7eb',
                  }}>
                  <span className={`bebas tracking-wider text-sm flex-1 ${hasBadge ? 'text-white' : 'text-gray-700'}`}>
                    Cartón #{ci + 1}
                  </span>
                  <div className="flex items-center gap-1 flex-wrap justify-end">
                    {wonPrizes.map(p => (
                      <span key={p.id} className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/25 text-white"
                        title={p.name}>{PRIZE_EMOJI[p.type]} {p.name}</span>
                    ))}
                    {!hasBadge && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Jugando</span>
                    )}
                    {!gameOver && (
                      <button onClick={() => openEdit(card)} title="Corregir números"
                        className={`w-6 h-6 rounded-full text-xs flex items-center justify-center
                          ${hasBadge ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-500'}`}>✎</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-5 bg-gray-50 border-b border-gray-100">
                  {COLS.map(l => (
                    <div key={l} className="text-center py-1 text-xs font-black bebas tracking-wider"
                      style={{ color: 'var(--primary)' }}>{l}</div>
                  ))}
                </div>

                <div className="grid grid-cols-5 gap-1 p-2 sm:gap-1.5 sm:p-2.5">
                  {card.numbers.map((row, r) => row.map((n, c) => {
                    const free = n === null
                    const marked = mk[r][c]
                    const cellRainbow = marked && rainbow
                    return (
                      <button key={`${r}${c}`} onClick={() => toggleCell(card.id, r, c)} disabled={free}
                        className={`bingo-cell aspect-square rounded-lg flex items-center justify-center font-bold
                          ${marked && !free ? 'marked' : ''} ${cellRainbow ? 'is-rainbow' : ''}`}
                        style={{
                          background: marked && !rainbow ? 'var(--primary)' : marked && rainbow ? undefined : '#f3f4f6',
                          color: marked ? '#fff' : '#374151',
                          cursor: free ? 'default' : 'pointer',
                          fontSize: 'clamp(0.6rem, 2.5vw, 0.8rem)',
                          boxShadow: marked && !free && !rainbow ? '0 2px 8px var(--primary-a35)' : 'none',
                        }}>
                        {free ? '★' : n}
                      </button>
                    )
                  })).flat()}
                </div>

                {near.length > 0 && (
                  <div className="px-3 pb-2.5 -mt-0.5 flex flex-wrap gap-1">
                    {near.map(({ p, m }) => (
                      <span key={p.id} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {p.name}: {m === 1 ? 'falta 1' : `faltan ${m}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
