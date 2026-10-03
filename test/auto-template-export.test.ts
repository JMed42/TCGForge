// Exports with templateId 'auto': each card gets the template its override or the project's
// rules pick. The render service is faked; the resolver is the real one (src/designer/rules).
import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { resolveAll } from '../src/designer/rules/resolveTemplate.ts'

const require = createRequire(import.meta.url)
const { tempDir, fakeIpc } = require('./helpers')
const database = require('../electron/database')
const { registerCardDesignerIpc } = require('../electron/cardDesigner/ipc')
const { blankTemplate } = require('../electron/cardDesigner/templates')
const ONE_PX_PNG: Buffer = require('canvas').createCanvas(1, 1).toBuffer('image/png')

async function setup() {
  const dir = tempDir('auto')
  await database.initDatabase(dir)
  const db = fakeIpc()
  database.registerIpcHandlers(db.ipcMain)
  const calls: { cards: Array<{ card: string; template: string }>; pages: any[] } = { cards: [], pages: [] }
  const render = {
    async renderCard({ template, card }: any) {
      calls.cards.push({ card: card.name, template: template.name })
      return { image: { toJPEG: () => Buffer.from('jpeg'), toPNG: () => ONE_PX_PNG }, report: { warnings: [] } }
    },
    async printPages(doc: any) {
      calls.pages.push(doc)
      return { pdf: Buffer.from('%PDF-1.4'), report: { warnings: [] } }
    },
  }
  const ipc = fakeIpc()
  registerCardDesignerIpc(ipc.ipcMain, {
    userDataPath: dir, getCard: database.getCard, queryCards: database.queryCards,
    listTemplates: database.listTemplates, getTemplate: database.getTemplate, insertTemplate: database.insertTemplate,
    updateTemplate: database.updateTemplate, deleteTemplate: database.deleteTemplate, listTemplateRules: database.listTemplateRules,
    resolveTemplates: ({ cards, rules, templateIds }: any) => {
      const res = resolveAll(cards, rules, templateIds)
      return new Map(cards.map((c: any) => [c.id, res.get(c.id)!.templateId]))
    },
    render, dialog: {}, shell: {}, getWindow: () => null,
  })
  const p = await db.call('createProject', { name: 'P' })
  const make = (name: string, size: object) => database.insertTemplate(p.id, name, JSON.stringify({ ...blankTemplate(name), size: { ...blankTemplate(name).size, ...size } }))
  const poker = make('Poker', {})
  const unit = make('Unit', {})
  const tarot = make('Tarot', { widthMm: 70, heightMm: 120 })
  for (const [name, type] of [['A', 'Unit'], ['B', 'Spell'], ['C', 'Land'], ['D', 'Unit']]) await db.call('createCard', p.id, { name, type })
  await db.call('saveTemplateRules', p.id, [
    { condition_expr: 'type == "Unit"', template_id: unit.id },
    { condition_expr: 'type == "Spell"', template_id: tarot.id },
  ])
  const d = (await db.call('getCards', p.id, {})).find((c: any) => c.name === 'D')
  await db.call('updateCard', d.id, { template_override_id: poker.id })
  return { dir, ipc, p, calls }
}

test('exportAllCards with auto uses rules, overrides and the default', async () => {
  const { dir, ipc, p, calls } = await setup()
  const res = await ipc.call('exportAllCards', p.id, 'auto', { format: 'jpeg', outputDir: path.join(dir, 'out') })
  assert.equal(res.exported, 4)
  assert.deepEqual(calls.cards, [
    { card: 'A', template: 'Unit' }, { card: 'B', template: 'Tarot' }, { card: 'C', template: 'Poker' }, { card: 'D', template: 'Poker' },
  ])
})

test('exportCard with auto resolves the single card', async () => {
  const { dir, ipc, p, calls } = await setup()
  const b = database.queryCards(p.id).find((c: any) => c.name === 'B')
  await ipc.call('exportCard', b.id, 'auto', { format: 'jpeg', outputPath: path.join(dir, 'b.jpg') })
  assert.deepEqual(calls.cards, [{ card: 'B', template: 'Tarot' }])
})

test('print sheets with auto group cards by card size, each item with its own template', async () => {
  const { dir, ipc, p, calls } = await setup()
  const out = path.join(dir, 'sheets.pdf')
  const res = await ipc.call('exportPrintSheets', p.id, 'auto', { paper: 'letter', bleedMm: 0, copies: 2, outputPath: out })
  assert.ok(fs.existsSync(out))
  const doc = calls.pages[0]
  // 63x88 group: A, C, D x2 copies = 6 slots on one Letter page; 70x120 group: B x2 on its own page.
  assert.equal(res.pages, 2)
  const names = doc.pages.map((pg: any) => pg.items.map((it: any) => `${it.card.name}:${it.template.name}`))
  assert.deepEqual(names, [
    ['A:Unit', 'A:Unit', 'C:Poker', 'C:Poker', 'D:Poker', 'D:Poker'],
    ['B:Tarot', 'B:Tarot'],
  ])
  assert.ok(doc.pages.every((pg: any) => pg.pageWidthMm > 0 && pg.pageHeightMm > 0))
  assert.ok(doc.pages.every((pg: any) => pg.items.every((it: any) => it.template.size.bleedMm === 0)), 'sheet bleed applies to every template')
})
