// Tests for the cockpit mod. Run: `claude plugin test plugins/aidlc-cockpit` (needs Claude Code;
// CI runs view.test.mjs instead, which holds the logic).
//
// Each hook the test registers stands for Claude Code: the working folder, the file listing, and the
// two `node` calls to core's scripts, answered with what those scripts print.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const RUNS = [
  { item: 'P-1', phase: 'implement' },
  { item: 'P-2', phase: 'blocked' },
]
const ROWS = [
  { item: 'S-1', repo: null, phase: 'verify', fixCycles: '0', branch: null, pr: null, session: 'aaaa1111', status: 'running', terminal: false },
  { item: 'S-2', repo: null, phase: 'design', fixCycles: '0', branch: null, pr: null, session: 'bbbb2222', status: 'NEEDS YOU', waitingFor: 'input needed', needsYou: 'input needed → claude attach bbbb2222', terminal: false },
]

type World = { config?: boolean; sprint?: { rows: unknown[]; allTerminal: boolean } | null }

function engine(on: On, world: World) {
  mock.clock(on, { now: 1_000_000 })
  const seen = { notified: [] as string[], copied: [] as string[] }
  on('command.register', () => ({ value: { command: 'aidlc-board' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_, e) => {
    seen.notified.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
  on('ui.copy', (_, e) => {
    seen.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  // Claude Code's own drawing, for when the mod yields the band to it.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.cwd', () => ({ value: '/ws' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  // Paths arrive in the platform's own spelling (backslashes on Windows), so match either separator.
  on('fs.exists', (_, e) => ({
    value: (world.config !== false && /[\\/]\.claude[\\/]aidlc\.config\.json$/.test(e.path)) || /aidlc-core[\\/]skills[\\/]sprint[\\/]sprint\.mjs$/.test(e.path),
  }))
  on('fs.list', (_, e) => ({
    value: /[\\/]ws[\\/]\.aidlc$/.test(e.path) && world.sprint ? [{ name: 'sprint-2026-10-25.json', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] : [],
  }))
  on('process.run', (_, e) => ({
    value: {
      exitCode: 0,
      stdout: JSON.stringify(e.argv.some(a => a.includes('run-files.mjs')) ? RUNS : world.sprint),
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  return seen
}

const BAND = {
  plugin: 'aidlc-cockpit',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const

const PANE = {
  plugin: 'aidlc-cockpit',
  component: 'Pane',
  requestId: 'aidlc-board',
  props: { title: 'AIDLC', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the band shows the runs core reports, waiting ones first, on every surface', async ($, on) => {
  engine(on, { sprint: null })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'aidlc-board' })
  expect(text).toContain('Runs (2):')

  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /P-2/ }))?.text).toBe('AIDLC  P-2 · blocked → /aidlc:run P-2')
    await ui.unmount()
  }
})

test('a sprint takes the band, and the board copies the attach command', async ($, on) => {
  const seen = engine(on, { sprint: { rows: ROWS, allTerminal: false } })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'aidlc-board' })

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /AIDLC sprint/ }))?.text).toBe('AIDLC sprint · 2 runs · 2 in flight · 1 needs you')
  expect((await band.find({ type: 'Text', text: /S-2/ }))?.text).toBe('  S-2: input needed → claude attach bbbb2222')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'attach-S-2' })
  expect(seen.copied).toEqual(['claude attach bbbb2222'])
  await pane.unmount()
})

test('a run that starts waiting raises a notification', async ($, on) => {
  const world: World = { sprint: { rows: [ROWS[0]], allTerminal: false } }
  const seen = engine(on, world)
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'aidlc-board' })
  world.sprint = { rows: [{ ...ROWS[0], status: 'NEEDS YOU', waitingFor: 'permission prompt', needsYou: 'x' }], allTerminal: false }
  await $.command.run({ command: 'aidlc-board' })
  expect(seen.notified).toContain('S-1 needs you: permission prompt')
})

test('Hide gives the band back', async ($, on) => {
  engine(on, { sprint: null })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'aidlc-board' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'aidlc-hide' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a phase change charges the phase that ended, in a file per item and session', async ($, on) => {
  engine(on, { sprint: null })
  // Paths arrive in the platform's spelling; key the fake disk by a normalized form.
  const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
  const disk: Record<string, string> = { '/ws/.aidlc/runs/P-1.md': '---\nitem: P-1\nphase: implement\n---\n' }
  let usd = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } as never }))
  on('session.id', () => ({ value: 'abcd1234-0000-0000' }))
  on('fs.read', (_, e) => {
    const text = disk[key(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    disk[key(e.path)] = e.text
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Write', file_path: '/ws/.aidlc/runs/P-1.md', content: 'x' })
  usd = 3.5
  disk['/ws/.aidlc/runs/P-1.md'] = '---\nitem: P-1\nphase: verify\n---\n'
  await $.tool.call({ tool: 'Bash', command: "sed -i 's/implement/verify/' .aidlc/runs/P-1.md" })

  const ledger = Object.entries(disk).find(([p]) => p.endsWith('/.aidlc/logs/costs/P-1--abcd1234.json'))
  expect(ledger).toBeDefined()
  expect(JSON.parse(ledger![1]).phases).toEqual({ implement: 2.5 })
})

test('outside an AIDLC workspace it draws nothing', async ($, on) => {
  engine(on, { config: false, sprint: null })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'aidlc-board' })
  expect(text).toContain('Not an AIDLC workspace')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
