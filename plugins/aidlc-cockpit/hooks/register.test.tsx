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

type World = {
  config?: boolean
  sprint?: { rows: unknown[]; allTerminal: boolean } | null
  /** What core's brain.mjs context and work-items/tree.mjs print, and `git status -z`. */
  context?: unknown
  tree?: unknown
  git?: string
  coreVersion?: string
  /** Files the fake disk holds, keyed by a normalized path. */
  disk?: Record<string, string>
}

// Paths arrive in the platform's spelling; the fake disk is keyed by a normalized form.
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

function engine(on: On, world: World) {
  mock.clock(on, { now: 1_000_000 })
  const seen = { notified: [] as string[], copied: [] as string[], filled: [] as string[] }
  const disk = (world.disk ??= {})
  on('fs.read', (_, e) => {
    if (/aidlc-core[\\/]\.claude-plugin[\\/]plugin\.json$/.test(e.path)) return { value: JSON.stringify({ version: world.coreVersion ?? '0.71.0' }) }
    const text = disk[key(e.path)]
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    disk[key(e.path)] = e.text
    return { value: undefined }
  })
  on('prompt.fill', (_, e) => {
    seen.filled.push(e.text)
    return { isFilled: true }
  })
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
  on('process.run', (_, e) => {
    const has = (name: string) => e.argv.some(a => a.includes(name))
    const stdout =
      e.argv[0] === 'git'
        ? (world.git ?? '## main\0')
        : JSON.stringify(
            has('run-files.mjs')
              ? RUNS
              : has('brain.mjs')
                ? (world.context ?? { modules: [], unmapped: [], partial: false })
                : has('tree.mjs')
                  ? (world.tree ?? null)
                  : world.sprint,
          )
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
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
  const disk: Record<string, string> = { '/ws/.aidlc/runs/P-1.md': '---\nitem: P-1\nphase: implement\n---\n' }
  engine(on, { sprint: null, disk })
  let usd = 1
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } as never }))
  on('session.id', () => ({ value: 'abcd1234-0000-0000' }))
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

const CONTEXT = {
  modules: [
    {
      name: 'bookings',
      page: 'modules/bookings',
      area: null,
      title: 'Bookings',
      purpose: 'Booking requests and their approval.',
      rules: ['Approvals never skip the manager.'],
      connectsTo: [],
      usedBy: [
        { name: 'invoices', recorded: true, live: true },
        { name: 'reports', recorded: false, live: true },
      ],
      assumed: 1,
      gaps: 0,
      state: 'current',
      behindFiles: 0,
      files: ['src/bookings/a.ts'],
    },
  ],
  unmapped: [],
  partial: false,
}

const node = (id: string, type: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  title: `${type} ${id}`,
  status,
  parent: null,
  run: null,
  counts: { total: 0, done: 0, openBugs: 0 },
  children: [],
  ...extra,
})
const TREE = {
  source: 'ado',
  roots: [
    node('10', 'epic', 'in_progress', {
      title: 'Bookings',
      counts: { total: 3, done: 1, openBugs: 1 },
      children: [
        node('11', 'story', 'done'),
        node('12', 'story', 'in_progress', { counts: { total: 1, done: 0, openBugs: 1 }, children: [node('14', 'bug', 'todo', { title: 'Reason lost' })] }),
      ],
    }),
  ],
  loose: [],
  hiddenDone: 0,
}

test('what the session changes leads the band: the module, what uses it, and the checks', async ($, on) => {
  engine(on, { sprint: null, context: CONTEXT, git: '## feature/x\0 M src/bookings/a.ts\0' })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/ws/src/bookings/a.ts', content: 'x' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const { text } = await $.command.run({ command: 'aidlc-board' })
  expect(text).toContain("You're in: Bookings")
  expect(text).toContain('Used by: invoices, reports (1 not on its page yet)')
  expect(text).toContain('This session · 1 file changed, 1 uncommitted')
  expect(text).toContain('bookings: a.ts · 1 uncommitted')

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.find({ type: 'Text', text: /bookings/ }))?.text).toBe('AIDLC  bookings · 1 file (1 uncommitted) · used by 2 · checks passed')
  await band.unmount()
})

test("the module's open questions put /aidlc:learn in the prompt", async ($, on) => {
  const seen = engine(on, { sprint: null, context: CONTEXT })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/ws/src/bookings/a.ts', content: 'x' })
  await $.command.run({ command: 'aidlc-board' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'learn-bookings' })
  expect(seen.filled).toEqual(['/aidlc:learn bookings'])
  await pane.unmount()
})

test('the board draws the epics as a tree, and Open shows what is under an item', async ($, on) => {
  engine(on, { sprint: null, tree: TREE })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'aidlc-board' })
  expect(text).toContain('Epics · 1 open')

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await pane.find({ type: 'Text', text: /#10 epic/ }))?.text).toBe('▾ #10 epic · Bookings · in progress · 1/3 done · 1 open bug')
  expect((await pane.find({ type: 'Text', text: /#12 story/ }))?.text).toBe('└─ ▸ #12 story · story 12 · in progress · 0/1 done · 1 open bug')
  expect(await pane.find({ type: 'Text', text: /#14 bug/ })).toBeFalsy()
  await pane.press({ key: 'tree-12' })
  expect((await pane.find({ type: 'Text', text: /#14 bug/ }))?.text).toBe('   └─ #14 bug · Reason lost · to do')
  await pane.unmount()
})

test('an older core is named, not shown as an empty board', async ($, on) => {
  engine(on, { sprint: null, coreVersion: '0.64.0' })
  await $.session.start({ cwd: '/ws', surface: 'terminal', isInteractive: true })
  const { text } = await $.command.run({ command: 'aidlc-board' })
  expect(text).toContain('this cockpit needs aidlc 0.71.0 or later (found 0.64.0)')
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
