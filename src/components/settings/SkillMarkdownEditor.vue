<template>
  <div ref="containerRef" class="skill-cm-editor" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  HighlightStyle,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'

const props = withDefaults(defineProps<{
  modelValue: string
  language?: 'markdown' | 'javascript' | 'json' | 'plain'
  placeholder?: string
  autofocus?: boolean
}>(), {
  language: 'markdown',
  placeholder: '',
  autofocus: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const containerRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let themeObserver: MutationObserver | null = null
let syncingFromProp = false

const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark'

type SelectionRect = {
  left: number
  top: number
  right: number
  bottom: number
}

type SelectionPoint = {
  x: number
  y: number
}

const samePoint = (a: SelectionPoint, b: SelectionPoint) => (
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
)

const pointKey = (point: SelectionPoint) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`

const containsPoint = (rect: SelectionRect, x: number, y: number) => (
  x > rect.left + 0.5
  && x < rect.right - 0.5
  && y > rect.top + 0.5
  && y < rect.bottom - 0.5
)

const addBoundary = (
  boundaries: Array<[SelectionPoint, SelectionPoint]>,
  rects: SelectionRect[],
  rect: SelectionRect,
  side: 'top' | 'right' | 'bottom' | 'left',
) => {
  const horizontal = side === 'top' || side === 'bottom'
  const start = horizontal ? rect.left : rect.top
  const end = horizontal ? rect.right : rect.bottom
  const splitPoints = [start, end]

  rects.forEach((other) => {
    const otherStart = horizontal ? other.left : other.top
    const otherEnd = horizontal ? other.right : other.bottom
    if (otherStart > start && otherStart < end) splitPoints.push(otherStart)
    if (otherEnd > start && otherEnd < end) splitPoints.push(otherEnd)
  })

  splitPoints.sort((a, b) => a - b)
  for (let index = 0; index < splitPoints.length - 1; index += 1) {
    const segmentStart = splitPoints[index]
    const segmentEnd = splitPoints[index + 1]
    if (segmentEnd - segmentStart < 0.5) continue

    const middle = (segmentStart + segmentEnd) / 2
    const x = horizontal ? middle : side === 'left' ? rect.left : rect.right
    const y = horizontal ? side === 'top' ? rect.top : rect.bottom : middle
    const offset = 1
    const outsideX = side === 'left' ? x - offset : side === 'right' ? x + offset : x
    const outsideY = side === 'top' ? y - offset : side === 'bottom' ? y + offset : y
    const covered = rects.some((other) => other !== rect && containsPoint(other, outsideX, outsideY))
    if (covered) continue

    if (side === 'top') {
      boundaries.push([{ x: segmentStart, y }, { x: segmentEnd, y }])
    } else if (side === 'right') {
      boundaries.push([{ x, y: segmentStart }, { x, y: segmentEnd }])
    } else if (side === 'bottom') {
      boundaries.push([{ x: segmentEnd, y }, { x: segmentStart, y }])
    } else {
      boundaries.push([{ x, y: segmentEnd }, { x, y: segmentStart }])
    }
  }
}

const selectionPath = (rects: SelectionRect[], radius = 4) => {
  if (!rects.length) return ''

  const boundaries: Array<[SelectionPoint, SelectionPoint]> = []
  rects.forEach((rect) => {
    addBoundary(boundaries, rects, rect, 'top')
    addBoundary(boundaries, rects, rect, 'right')
    addBoundary(boundaries, rects, rect, 'bottom')
    addBoundary(boundaries, rects, rect, 'left')
  })
  if (!boundaries.length) return ''

  const nextBoundary = new Map<string, [SelectionPoint, SelectionPoint][]>()
  boundaries.forEach((boundary) => {
    const key = pointKey(boundary[0])
    const list = nextBoundary.get(key) || []
    list.push(boundary)
    nextBoundary.set(key, list)
  })

  const ordered: SelectionPoint[] = [boundaries[0][0], boundaries[0][1]]
  const usedBoundaries = new Set<Array<SelectionPoint>>([boundaries[0]])
  let current = boundaries[0][1]
  while (!samePoint(current, ordered[0])) {
    const candidates = nextBoundary.get(pointKey(current)) || []
    const next = candidates.find((boundary) => !usedBoundaries.has(boundary))
    if (!next) break
    usedBoundaries.add(next)
    ordered.push(next[1])
    current = next[1]
    if (ordered.length > boundaries.length + 1) break
  }
  if (ordered.length < 4 || !samePoint(ordered[ordered.length - 1], ordered[0])) return ''
  ordered.pop()

  const points = ordered.filter((point, index) => {
    const previous = ordered[(index + ordered.length - 1) % ordered.length]
    const next = ordered[(index + 1) % ordered.length]
    const cross = (point.x - previous.x) * (next.y - point.y)
      - (point.y - previous.y) * (next.x - point.x)
    return Math.abs(cross) > 0.5
  })
  if (points.length < 3) return ''

  const corners = points.map((point, index) => {
    const previous = points[(index + points.length - 1) % points.length]
    const next = points[(index + 1) % points.length]
    const previousLength = Math.hypot(point.x - previous.x, point.y - previous.y)
    const nextLength = Math.hypot(next.x - point.x, next.y - point.y)
    const cornerRadius = Math.min(radius, previousLength / 2, nextLength / 2)
    const previousRatio = cornerRadius / previousLength
    const nextRatio = cornerRadius / nextLength
    return {
      point,
      incoming: {
        x: point.x + (previous.x - point.x) * previousRatio,
        y: point.y + (previous.y - point.y) * previousRatio,
      },
      outgoing: {
        x: point.x + (next.x - point.x) * nextRatio,
        y: point.y + (next.y - point.y) * nextRatio,
      },
    }
  })

  const first = corners[0]
  const commands = [`M ${first.incoming.x} ${first.incoming.y}`]
  corners.forEach((corner, index) => {
    commands.push(`Q ${corner.point.x} ${corner.point.y} ${corner.outgoing.x} ${corner.outgoing.y}`)
    const next = corners[(index + 1) % corners.length]
    commands.push(`L ${next.incoming.x} ${next.incoming.y}`)
  })
  commands.push('Z')
  return commands.join(' ')
}

const roundedRectPath = (rect: SelectionRect, radius = 4) => {
  const width = rect.right - rect.left
  const height = rect.bottom - rect.top
  const rad = Math.min(radius, width / 2, height / 2)
  if (rad <= 0) {
    return `M ${rect.left} ${rect.top} L ${rect.right} ${rect.top} L ${rect.right} ${rect.bottom} L ${rect.left} ${rect.bottom} Z`
  }
  return [
    `M ${rect.left + rad} ${rect.top}`,
    `L ${rect.right - rad} ${rect.top}`,
    `Q ${rect.right} ${rect.top} ${rect.right} ${rect.top + rad}`,
    `L ${rect.right} ${rect.bottom - rad}`,
    `Q ${rect.right} ${rect.bottom} ${rect.right - rad} ${rect.bottom}`,
    `L ${rect.left + rad} ${rect.bottom}`,
    `Q ${rect.left} ${rect.bottom} ${rect.left} ${rect.bottom - rad}`,
    `L ${rect.left} ${rect.top + rad}`,
    `Q ${rect.left} ${rect.top} ${rect.left + rad} ${rect.top}`,
    'Z',
  ].join(' ')
}

const rectsTouch = (a: SelectionRect, b: SelectionRect) => {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
  const touchX = Math.abs(a.right - b.left) < 0.6 || Math.abs(b.right - a.left) < 0.6
  const touchY = Math.abs(a.bottom - b.top) < 0.6 || Math.abs(b.bottom - a.top) < 0.6
  return (overlapX && (overlapY || touchY)) || (overlapY && (overlapX || touchX))
}

const connectedRectGroups = (rects: SelectionRect[]) => {
  const groups: SelectionRect[][] = []
  const used = new Set<number>()
  rects.forEach((_, start) => {
    if (used.has(start)) return
    const group = [rects[start]]
    used.add(start)
    for (let index = 0; index < group.length; index += 1) {
      rects.forEach((rect, candidate) => {
        if (used.has(candidate) || !rectsTouch(group[index], rect)) return
        used.add(candidate)
        group.push(rect)
      })
    }
    groups.push(group)
  })
  return groups
}

const selectionShapePath = (rects: SelectionRect[], radius = 4) => (
  connectedRectGroups(rects)
    .map((group) => selectionPath(group, radius) || group.map((rect) => roundedRectPath(rect, radius)).join(' '))
    .join(' ')
)

const collectSelectionRects = (view: EditorView): SelectionRect[] => {
  const lineHeight = 20
  const scroll = view.scrollDOM
  const scrollRect = scroll.getBoundingClientRect()
  const toLayerX = (x: number) => x - scrollRect.left + scroll.scrollLeft
  const toLayerY = (y: number) => y - scrollRect.top + scroll.scrollTop
  const contentRect = view.contentDOM.getBoundingClientRect()
  const lineEl = view.contentDOM.querySelector('.cm-line')
  const lineStyle = lineEl ? getComputedStyle(lineEl) : null
  const padLeft = lineStyle ? Number.parseInt(lineStyle.paddingLeft, 10) || 0 : 0
  const leftSide = toLayerX(contentRect.left + padLeft)
  const spaceWidth = Math.max(view.defaultCharacterWidth, 6)
  const bands: Array<{ left: number; right: number }> = []

  const pushBand = (left: number, right: number) => {
    if (right > left + 0.5) bands.push({ left, right })
  }

  for (const range of view.state.selection.ranges) {
    if (range.empty) continue
    const from = Math.max(range.from, view.viewport.from)
    const to = Math.min(range.to, view.viewport.to)
    if (from >= to) continue

    let pos = from
    while (pos < to) {
      const line = view.state.doc.lineAt(pos)
      const selFrom = Math.max(range.from, line.from)
      const selTo = Math.min(range.to, line.to)
      const includesBreak = range.to > line.to
      const emptyLine = line.from === line.to || selFrom >= selTo

      if (emptyLine) {
        const startCoords = view.coordsAtPos(line.from, 1)
        const left = startCoords ? toLayerX(startCoords.left) : leftSide
        pushBand(left, left + spaceWidth)
        pos = line.to + 1
        continue
      }

      let visualFrom = selFrom
      while (visualFrom < selTo) {
        const wrapEnd = view.moveToLineBoundary(EditorSelection.cursor(visualFrom), true, true).head
        const pieceEnd = wrapEnd > visualFrom ? Math.min(selTo, wrapEnd) : selTo
        const pieceStartCoords = view.coordsAtPos(visualFrom, 1)
        const pieceEndCoords = view.coordsAtPos(pieceEnd, -1)
        const pieceLeft = pieceStartCoords ? toLayerX(pieceStartCoords.left) : leftSide
        const pieceRight = pieceEndCoords ? toLayerX(pieceEndCoords.right) : pieceLeft
        const lastVisual = pieceEnd >= selTo
        pushBand(
          pieceLeft,
          Math.max(pieceLeft + 0.5, pieceRight) + (lastVisual && includesBreak ? spaceWidth : 0),
        )
        if (pieceEnd <= visualFrom) break
        visualFrom = pieceEnd
      }

      pos = line.to + 1
    }
  }

  if (!bands.length) return []

  const firstLine = view.state.doc.lineAt(Math.max(view.state.selection.main.from, view.viewport.from))
  const firstCoords = view.coordsAtPos(Math.max(view.state.selection.main.from, firstLine.from), 1)
  const origin = firstCoords
    ? toLayerY((firstCoords.top + firstCoords.bottom) / 2) - lineHeight / 2
    : 0

  return bands.map((band, index) => ({
    left: band.left,
    right: band.right,
    top: origin + index * lineHeight,
    bottom: origin + (index + 1) * lineHeight,
  }))
}

const selectionShapePlugin = ViewPlugin.fromClass(class {
  private view: EditorView
  private frame = 0
  private layer: HTMLDivElement
  private svg: SVGSVGElement
  private path: SVGPathElement

  constructor(view: EditorView) {
    this.view = view
    this.layer = document.createElement('div')
    this.layer.className = 'cm-custom-selection-layer'
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    this.svg.appendChild(this.path)
    this.layer.appendChild(this.svg)
    view.scrollDOM.appendChild(this.layer)
    this.schedule()
  }

  update(update: ViewUpdate) {
    if (update.selectionSet || update.docChanged || update.geometryChanged || update.viewportChanged) {
      this.schedule()
    }
  }

  private schedule() {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => {
      this.frame = requestAnimationFrame(() => this.renderSelectionShape())
    })
  }

  private renderSelectionShape() {
    const rects = collectSelectionRects(this.view)
    const width = Math.max(this.view.scrollDOM.scrollWidth, this.view.scrollDOM.clientWidth)
    const height = Math.max(this.view.scrollDOM.scrollHeight, this.view.scrollDOM.clientHeight)
    this.layer.style.width = `${width}px`
    this.layer.style.height = `${height}px`
    this.svg.setAttribute('width', String(width))
    this.svg.setAttribute('height', String(height))
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    this.path.setAttribute('d', selectionShapePath(rects))
  }

  destroy() {
    cancelAnimationFrame(this.frame)
    this.layer.remove()
  }
})

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'var(--skill-editor-bg, #ffffff)',
    color: 'var(--skill-editor-fg, #24292f)',
  },
  '&.cm-editor': {
    height: '100%',
    outline: 'none',
    backgroundColor: 'var(--skill-editor-bg, #ffffff)',
  },
  '&.cm-editor.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    fontSize: '13px',
    lineHeight: '20px',
    overflow: 'auto',
    scrollbarColor: 'var(--skill-editor-scrollbar, #cbd5e1) transparent',
  },
  '.cm-content': {
    padding: '12px 16px 12px 6px',
    caretColor: 'var(--skill-editor-caret, #667eea)',
    minHeight: '100%',
  },
  '.cm-line': {
    padding: '0 8px 0 0',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--skill-editor-bg, #ffffff)',
    borderRight: 'none',
    color: 'var(--skill-editor-gutter-fg, #9ca3af)',
    minWidth: '36px',
    paddingRight: '0',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2em',
    padding: '0 4px 0 8px',
    fontSize: '12px',
  },
  '.cm-selectionLayer': {
    display: 'none',
  },
  '.cm-custom-selection-layer': {
    position: 'absolute',
    left: '0',
    top: '0',
    zIndex: '-1',
    pointerEvents: 'none',
  },
  '.cm-custom-selection-layer svg': {
    display: 'block',
    overflow: 'visible',
  },
  '.cm-custom-selection-layer path': {
    fill: 'var(--skill-editor-selection, #cfe2ff)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--skill-editor-selection-match, rgba(255, 213, 79, 0.3))',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--skill-editor-caret, #667eea)',
    borderLeftWidth: '1px',
    marginLeft: '-0.5px',
  },
  '.cm-foldGutter': {
    width: '12px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0',
    opacity: '0',
  },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement, .cm-foldGutter .cm-gutterElement:has(.cm-fold-marker-closed)': {
    opacity: '1',
  },
  '.cm-foldGutter .cm-fold-marker': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '10px',
    height: '10px',
    color: 'var(--skill-editor-gutter-fg, #9ca3af)',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-fold-marker svg': {
    display: 'block',
    width: '8px',
    height: '8px',
  },
  '.cm-foldGutter .cm-fold-marker-open svg': {
    transform: 'translateY(-0.6px)',
  },
  '.cm-foldGutter .cm-fold-marker-closed svg': {
    transform: 'translateX(-0.6px)',
  },
  '.cm-placeholder': {
    color: 'var(--skill-editor-placeholder, #9ca3af)',
    fontStyle: 'italic',
  },
})

const codeLanguages = (info: string) => {
  const name = String(info || '').trim().split(/[\s,]+/)[0]?.toLowerCase() || ''
  if (name === 'json') return json().language
  if (
    name === 'js'
    || name === 'javascript'
    || name === 'ts'
    || name === 'typescript'
    || name === 'mjs'
    || name === 'cjs'
  ) return javascript().language
  return null
}

const codeHighlightStyle = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.comment, color: 'var(--skill-tok-comment)', fontStyle: 'italic' },
  { tag: tags.lineComment, color: 'var(--skill-tok-comment)', fontStyle: 'italic' },
  { tag: tags.blockComment, color: 'var(--skill-tok-comment)', fontStyle: 'italic' },
  { tag: tags.docComment, color: 'var(--skill-tok-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--skill-tok-keyword)' },
  { tag: tags.controlKeyword, color: 'var(--skill-tok-keyword)' },
  { tag: tags.definitionKeyword, color: 'var(--skill-tok-keyword)' },
  { tag: tags.moduleKeyword, color: 'var(--skill-tok-keyword)' },
  { tag: tags.operatorKeyword, color: 'var(--skill-tok-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--skill-tok-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--skill-tok-number)' },
  { tag: [tags.bool, tags.null, tags.atom], color: 'var(--skill-tok-constant)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--skill-tok-property)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.variableName)], color: 'var(--skill-tok-function)' },
  { tag: tags.variableName, color: 'var(--skill-tok-variable)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.self], color: 'var(--skill-tok-type)' },
  { tag: tags.operator, color: 'var(--skill-tok-operator)' },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.squareBracket, tags.paren, tags.brace], color: 'var(--skill-tok-punctuation)' },
  { tag: [tags.meta, tags.processingInstruction, tags.modifier], color: 'var(--skill-tok-meta)' },
  { tag: tags.invalid, color: 'var(--skill-tok-invalid)' },
  { tag: tags.heading1, color: 'var(--skill-tok-heading)', fontWeight: '700' },
  { tag: tags.heading2, color: 'var(--skill-tok-heading)', fontWeight: '650' },
  { tag: tags.heading3, color: 'var(--skill-tok-heading)', fontWeight: '600' },
  { tag: tags.heading4, color: 'var(--skill-tok-heading)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--skill-tok-strong)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--skill-tok-emphasis)' },
  { tag: [tags.link, tags.url], color: 'var(--skill-tok-link)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--skill-tok-string)' },
  { tag: tags.quote, color: 'var(--skill-tok-comment)', fontStyle: 'italic' },
  { tag: tags.escape, color: 'var(--skill-tok-constant)' },
  { tag: tags.labelName, color: 'var(--skill-tok-property)' },
]), { fallback: true })

const buildExtensions = () => {
  const lang = props.language === 'markdown'
    ? [markdown({ codeLanguages })]
    : props.language === 'javascript'
      ? [javascript()]
      : props.language === 'json'
        ? [json()]
        : []
  const themeExt = isDark()
    ? [oneDark, codeHighlightStyle]
    : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), codeHighlightStyle]

  return [
    lineNumbers(),
    foldGutter({
      markerDOM: (open) => {
        const marker = document.createElement('span')
        marker.className = open ? 'cm-fold-marker cm-fold-marker-open' : 'cm-fold-marker cm-fold-marker-closed'
        marker.innerHTML = open
          ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 6.1 L8 11.2 L12.8 6.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 3.2 L11.2 8 L6.1 12.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        return marker
      },
    }),
    drawSelection(),
    selectionShapePlugin,
    indentOnInput(),
    bracketMatching(),
    history(),
    ...lang,
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
    ]),
    EditorView.lineWrapping,
    ...themeExt,
    editorTheme,
    ...(props.placeholder ? [cmPlaceholder(props.placeholder)] : []),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || syncingFromProp) return
      emit('update:modelValue', update.state.doc.toString())
    }),
  ]
}

const createEditor = (doc: string) => {
  if (!containerRef.value) return
  view?.destroy()
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: buildExtensions(),
    }),
    parent: containerRef.value,
  })
  if (props.autofocus) {
    view.focus()
  }
}

const setDoc = (text: string) => {
  if (!view) return
  const current = view.state.doc.toString()
  if (current === text) return
  syncingFromProp = true
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  })
  syncingFromProp = false
}

const focus = () => {
  view?.focus()
}

const getValue = () => view?.state.doc.toString() ?? props.modelValue ?? ''

defineExpose({ focus, getValue })

watch(() => props.modelValue, (value) => {
  setDoc(value ?? '')
})

watch(() => props.language, () => {
  const text = view?.state.doc.toString() ?? props.modelValue
  createEditor(text)
})

onMounted(() => {
  createEditor(props.modelValue ?? '')
  themeObserver = new MutationObserver(() => {
    const text = view?.state.doc.toString() ?? props.modelValue
    createEditor(text)
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onUnmounted(() => {
  themeObserver?.disconnect()
  themeObserver = null
  view?.destroy()
  view = null
})
</script>

<style scoped>
.skill-cm-editor {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  overflow: hidden;
  --skill-editor-bg: var(--bg-secondary, #ffffff);
  --skill-editor-fg: var(--text-primary, #24292f);
  --skill-editor-active-line: color-mix(in srgb, var(--hover-bg, rgba(0, 0, 0, 0.04)) 85%, transparent);
  --skill-editor-gutter-fg: var(--text-tertiary, #9ca3af);
  --skill-editor-gutter-active: var(--text-secondary, #4b5563);
  --skill-editor-gutter-border: var(--border-color, #e5e7eb);
  --skill-editor-selection: color-mix(in srgb, var(--text-primary, #24292f) 12%, transparent);
  --skill-editor-selection-match: color-mix(in srgb, #f59e0b 24%, transparent);
  --skill-editor-caret: var(--color-accent, #667eea);
  --skill-editor-placeholder: var(--text-tertiary, #9ca3af);
  --skill-editor-scrollbar: var(--border-color, #cbd5e1);
  --skill-tok-comment: #6e7781;
  --skill-tok-keyword: #cf222e;
  --skill-tok-string: #0a3069;
  --skill-tok-number: #0550ae;
  --skill-tok-constant: #0550ae;
  --skill-tok-property: #0550ae;
  --skill-tok-function: #8250df;
  --skill-tok-variable: #953800;
  --skill-tok-type: #953800;
  --skill-tok-operator: #cf222e;
  --skill-tok-punctuation: #57606a;
  --skill-tok-meta: #6e7781;
  --skill-tok-invalid: #cf222e;
  --skill-tok-heading: #0969da;
  --skill-tok-strong: #24292f;
  --skill-tok-emphasis: #8250df;
  --skill-tok-link: #0969da;
  background: var(--skill-editor-bg);
}

:global([data-theme="dark"]) .skill-cm-editor {
  --skill-editor-bg: #1e1e1e;
  --skill-editor-fg: #d4d4d4;
  --skill-editor-active-line: #2a2d2e;
  --skill-editor-gutter-fg: #858585;
  --skill-editor-gutter-active: #c6c6c6;
  --skill-editor-gutter-border: #303030;
  --skill-editor-selection: rgba(255, 255, 255, 0.12);
  --skill-editor-selection-match: #515c6a;
  --skill-editor-caret: #aeafad;
  --skill-editor-placeholder: #6a6a6a;
  --skill-editor-scrollbar: #424242;
  --skill-tok-comment: #8b949e;
  --skill-tok-keyword: #ff7b72;
  --skill-tok-string: #a5d6ff;
  --skill-tok-number: #79c0ff;
  --skill-tok-constant: #79c0ff;
  --skill-tok-property: #79c0ff;
  --skill-tok-function: #d2a8ff;
  --skill-tok-variable: #ffa657;
  --skill-tok-type: #ffa657;
  --skill-tok-operator: #ff7b72;
  --skill-tok-punctuation: #c9d1d9;
  --skill-tok-meta: #8b949e;
  --skill-tok-invalid: #ff7b72;
  --skill-tok-heading: #58a6ff;
  --skill-tok-strong: #e6edf3;
  --skill-tok-emphasis: #d2a8ff;
  --skill-tok-link: #58a6ff;
}
</style>
