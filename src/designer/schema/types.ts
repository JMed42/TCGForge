// Template schema v1 (docs/card-designer-spec.md, "Template schema"). Lengths are millimetres,
// or "N%" of the parent box. Extensions beyond the spec are marked "ext".

export type Length = number | string // 12.5 (mm) or "50%"

export interface Frame {
  left?: Length
  right?: Length
  width?: Length
  top?: Length
  bottom?: Length
  height?: Length
}

export interface TextStyle {
  font?: string
  sizePt?: number
  weight?: number
  italic?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom' // ext
  lineHeight?: number // ext: multiple of font size
  letterSpacingPt?: number // ext
  wrap?: boolean // ext: false = single line, clipped
}

export type FitStrategy = 'shrink' | 'tightenLeading' | 'hide'

export interface Fit {
  minPt?: number
  maxPt?: number
  strategy?: FitStrategy[]
}

interface LayerBase {
  id: string
  frame?: Frame
  visibleIf?: string
  priority?: number
  opacity?: number // ext
  hidden?: boolean // ext, editor only: never rendered
  locked?: boolean // ext, editor only: not selectable on the canvas
}

export interface TextLayer extends LayerBase {
  type: 'text' | 'richText'
  text: string
  style?: TextStyle
  fit?: Fit
}

export interface ImageLayer extends LayerBase {
  type: 'image'
  src: string
  objectFit?: 'cover' | 'contain' | 'fill' | 'tile'
  objectPosition?: string // ext: CSS object-position, e.g. "50% 0%"
  placeholder?: 'proxy' | 'none'
  radiusMm?: number // ext
}

export interface ShapeLayer extends LayerBase {
  type: 'shape'
  shape: 'rect' | 'roundRect' | 'ellipse'
  fill?: string
  stroke?: string
  strokeMm?: number // ext
  radiusMm?: number // ext (roundRect)
}

export interface IconRepeatLayer extends LayerBase {
  type: 'iconRepeat' // rendered from Phase 4; a placeholder until then
  count: string
  icon: string
  direction?: 'ltr' | 'rtl' | 'ttb' | 'btt'
}

export interface StackLayer extends LayerBase {
  type: 'stack'
  direction?: 'vertical' | 'horizontal'
  gapMm?: number
  // ext: when the text doesn't fit, shrink first and then hide (default, the spec's answer to its
  // open question), or hide first
  fitOrder?: 'shrinkFirst' | 'hideFirst'
  children: Layer[]
}

export interface GroupLayer extends LayerBase {
  type: 'group'
  children: Layer[]
}

export type Layer = TextLayer | ImageLayer | ShapeLayer | IconRepeatLayer | StackLayer | GroupLayer
export type ContainerLayer = StackLayer | GroupLayer

export interface CardSize {
  widthMm: number
  heightMm: number
  bleedMm: number
  safeMm: number
  cornerRadiusMm?: number // ext
}

export interface Template {
  schemaVersion: 1
  name?: string
  size: CardSize
  layers: Layer[]
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const isContainer = (l: Layer): l is ContainerLayer => l.type === 'stack' || l.type === 'group'
