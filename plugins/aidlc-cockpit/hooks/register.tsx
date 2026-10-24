// aidlc-cockpit — AIDLC beside the chat.
//
// It gates no tool call, rewrites no prompt and approves nothing. What it shows comes from core's
// scripts (run-files.mjs, sprint.mjs, costs.mjs), found next to this plugin, so it can never disagree
// with /aidlc:status, /aidlc:sprint or /aidlc:insights. What to show is decided in view.mjs; this file
// gathers and draws.
//
// The one thing it writes is the cost ledger: what each work item cost, by phase, from Claude Code's own
// session cost (view.mjs → *the cost ledger*). One file per item per session, under the main checkout's
// git-ignored `.aidlc/logs/costs/`.
//
// Cost: no model calls, ever. A board refresh runs at most three short `node` processes, every 30
// seconds and only while a surface is drawing, so an unattended background sprint run polls nothing.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitBoardRow, CockpitRun, CockpitSnapshot, CockpitSprint } from '../types'
import type { Charge, Ledger, LedgerFile } from './view.mjs'
import {
  advance,
  bandModel,
  boardText,
  cacheDirOf,
  commandItem,
  coreCandidates,
  ledgerName,
  mergeLedger,
  newestSprintFile,
  phaseOf,
  runFileTarget,
  runLine,
  toSlash,
  transitions,
} from './view.mjs'

const PANE = 'aidlc-board'
const COMMAND = 'aidlc-board'
const POLL_MS = 30_000
const FLUSH_MS = 120_000
const MIN_GAP_MS = 5_000

// Change the shape tag when the snapshot's fields change: a reload keeps $.state, and the tag makes
// the new code decline what the old code stored instead of misreading it.
const snapshot = atom({ plugin: 'aidlc-cockpit', key: 'snapshot' } as const, null, { shape: 'snapshot-2' })
const hidden = atom({ plugin: 'aidlc-cockpit', key: 'hidden' } as const, false)

const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Module variables start over on a reload. For the ledger that means a reload in the middle of a phase
// charges what was spent before it to nothing; the next flush or phase change picks it up again.
let core: string | null | undefined // undefined: not looked for yet; null: not found
let lastRows: CockpitBoardRow[] | null = null
let busy = false
let lastAt = 0
let ledger: Ledger = { item: null, phase: null, baseline: null }
let costRoot: string | undefined
let sessionId: string | undefined

// Claude Code traces every call a mod makes on `$`, so `$` is only ever passed to functions declared
// at the top of this file.
async function findCore($: EngineInterface): Promise<string | null> {
  let versions: string[] = []
  try {
    versions = (await $.fs.list(cacheDirOf($.plugin.root))).filter(e => e.kind === 'dir').map(e => e.name)
  } catch {
    // no plugin cache next to us: a checkout or a folder marketplace
  }
  for (const dir of coreCandidates($.plugin.root, versions))
    if (await $.fs.exists(`${dir}/skills/sprint/sprint.mjs`)) return dir
  return null
}

async function nodeJson($: EngineInterface, args: string[], cwd: string): Promise<unknown> {
  try {
    const r = await $.process.run(['node', ...args], { cwd, timeoutMs: 30_000 })
    return r.exitCode === 0 ? JSON.parse(r.stdout) : null
  } catch {
    return null
  }
}

// The main checkout of a folder. A mono sprint run works in a worktree that is removed when the sprint
// wraps up; its ledger must not go with it.
async function mainCheckout($: EngineInterface, cwd: string): Promise<string> {
  try {
    const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, timeoutMs: 10_000 })
    const dir = toSlash(r.stdout.trim())
    if (r.exitCode === 0 && /\/\.git$/.test(dir)) return dir.slice(0, -'/.git'.length)
  } catch {
    // not a git repository: keep the ledger where the session is
  }
  return cwd
}

// What the session has cost so far, as /cost totals it (subagents included), or null where unknown.
async function spent($: EngineInterface): Promise<number | null> {
  try {
    const usd = (await $.session.usage()).cost?.usd
    return typeof usd === 'number' && Number.isFinite(usd) ? usd : null
  } catch {
    return null
  }
}

async function writeCharges($: EngineInterface, charges: readonly Charge[]): Promise<void> {
  if (!charges.length) return
  costRoot ??= await mainCheckout($, toSlash(await $.session.cwd()))
  sessionId ??= await $.session.id()
  const now = new Date(await $.clock.now()).toISOString()
  for (const item of new Set(charges.map(c => c.item))) {
    const path = `${costRoot}/.aidlc/logs/costs/${ledgerName(item, sessionId)}`
    let existing: LedgerFile | null = null
    try {
      existing = JSON.parse(await $.fs.read(path)) as LedgerFile
    } catch {
      // the first charge for this item in this session
    }
    const file = mergeLedger(existing, { item, session: sessionId.slice(0, 8), now }, charges.filter(c => c.item === item))
    await $.fs.write(path, `${JSON.stringify(file, null, 2)}\n`)
  }
}

// Move the ledger to the item and phase now in force (null: none), charging what was spent since.
async function track($: EngineInterface, next: { item: string; phase: string } | null): Promise<void> {
  const usd = await spent($)
  if (usd == null) return
  const step = advance(ledger, next, usd)
  ledger = step.ledger
  await writeCharges($, step.charges)
}

// Charge what the current phase has spent so far, and carry on. Bounds what a crash can lose.
async function flush($: EngineInterface): Promise<void> {
  if (ledger.item && ledger.phase) await track($, { item: ledger.item, phase: ledger.phase })
}

async function readPhase($: EngineInterface, path: string): Promise<string | null> {
  const cwd = toSlash(await $.session.cwd())
  const p = toSlash(path)
  try {
    return phaseOf(await $.fs.read(/^([A-Za-z]:)?\//.test(p) ? p : `${cwd}/${p}`))
  } catch {
    return null
  }
}

// A run file was written: if its phase moved, the phase that ended is charged.
async function noteRunFile($: EngineInterface, target: { item: string; path: string }): Promise<void> {
  const phase = await readPhase($, target.path)
  if (!phase || (ledger.item === target.item && ledger.phase === phase)) return
  await track($, { item: target.item, phase })
}

// `/aidlc:run <ID>` typed by name: charge from its first turn, in the phase its run file is already at.
async function noteRunCommand($: EngineInterface, item: string): Promise<void> {
  const phase = (await readPhase($, `.aidlc/runs/${item}.md`)) ?? 'start'
  await track($, { item, phase })
}

async function refresh($: EngineInterface, force = false): Promise<void> {
  const now = await $.clock.now()
  if (busy || (!force && now - lastAt < MIN_GAP_MS)) return
  busy = true
  lastAt = now
  try {
    const cwd = toSlash(await $.session.cwd())
    if (!(await $.fs.exists(`${cwd}/.claude/aidlc.config.json`))) {
      await update($, snapshot, () => null)
      return
    }
    if (core === undefined) core = await findCore($)
    if (!core) {
      await update($, snapshot, () => ({ runs: [], sprint: null, at: now, problem: 'the aidlc plugin was not found next to aidlc-cockpit — install aidlc@aidlc' }))
      return
    }
    const runs = ((await nodeJson($, [`${core}/hooks/scripts/lib/run-files.mjs`, cwd, '--json'], cwd)) as CockpitRun[] | null) ?? []
    let sprint: CockpitSprint | null = null
    let listing: Awaited<ReturnType<EngineInterface['fs']['list']>> = []
    try {
      listing = await $.fs.list(`${cwd}/.aidlc`)
    } catch {
      // no .aidlc yet
    }
    const file = newestSprintFile(listing)
    if (file) sprint = (await nodeJson($, [`${core}/skills/sprint/sprint.mjs`, 'board', '--sprint-file', `${cwd}/.aidlc/${file}`, '--json'], cwd)) as CockpitSprint | null

    // What each item has cost: the ledger as core reads it, plus what this session has spent on its
    // item since the last charge.
    costRoot ??= await mainCheckout($, cwd)
    const costs: Record<string, number> = {}
    if (await $.fs.exists(`${costRoot}/.aidlc/logs/costs`)) {
      const read = (await nodeJson($, [`${core}/skills/insights/costs.mjs`, costRoot, '--json'], cwd)) as { byItem?: Record<string, { usd: number }> } | null
      for (const [id, it] of Object.entries(read?.byItem ?? {})) costs[id] = it.usd
    }
    if (ledger.item && ledger.baseline != null) {
      const usd = await spent($)
      if (usd != null && usd > ledger.baseline) costs[ledger.item] = (costs[ledger.item] ?? 0) + (usd - ledger.baseline)
    }

    for (const t of transitions(lastRows, sprint?.rows ?? null)) {
      void $.ui.notify(t.text, { title: 'AIDLC sprint' })
      $.ui.toast(t.text)
    }
    lastRows = sprint?.rows ?? null
    const snap: CockpitSnapshot = { runs, sprint, costs, at: now, problem: null }
    await update($, snapshot, () => snap)
  } finally {
    busy = false
  }
}

// The timer's tick: look again only while something is drawing.
async function poll($: EngineInterface): Promise<void> {
  if ((await $.session.surfaces()).length) await refresh($)
}

async function settle($: EngineInterface): Promise<void> {
  await flush($)
  await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The ledger is kept in every session, a background or `claude -p` sprint run included.
    $.clock.every(FLUSH_MS, () => void flush($))
    // The board only where something draws.
    if (e.isInteractive) {
      await $.command.register({
        name: 'aidlc-board',
        description: 'AIDLC runs and sprint board, with no model turn',
        immediate: true,
      })
      $.clock.after(1, () => void refresh($, true))
      $.clock.every(POLL_MS, () => void poll($))
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      await flush($)
    } catch {
      // a ledger is never worth delaying an exit over
    }
    return next(e)
  })

  // `/aidlc:run <ID>`: the run is charged from its first turn.
  on('prompt.submit', async ($, e, next) => {
    const item = commandItem(e.command)
    if (item) {
      try {
        await noteRunCommand($, item)
      } catch {
        // never stand between a person and their prompt
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The pipeline writes the run file at every phase change; the call itself always goes ahead untouched.
  on('tool.call', async ($, e, next) => {
    const target = runFileTarget(String(e.tool), e as unknown as { command?: unknown; file_path?: unknown })
    const ran = await next(e)
    if (target) {
      try {
        await noteRunFile($, target)
      } catch {
        // the ledger is best-effort; the tool call already happened
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Run files change during turns: settle the ledger and look again when the main turn ends.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) $.clock.after(250, () => void settle($))
    return result
  })

  on('command.run', { command: 'aidlc-board' }, async $ => {
    await update($, hidden, () => false)
    await refresh($, true)
    await $.ui.open({ id: PANE, title: 'AIDLC' })
    return { text: boardText(await read($, snapshot)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    const band = bandModel(await read($, snapshot))
    if (!band) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {band.lines.map(line => (
          <Text color={line.tone === 'warning' ? 'warning' : 'subtle'} wrap="truncate-end">
            {line.text}
          </Text>
        ))}
        <Box flexDirection="row" gap="sm">
          <Button key="aidlc-board" label="Board" onPress={() => void $.ui.open({ id: PANE, title: 'AIDLC' })} />
          <Button key="aidlc-hide" label="Hide" onPress={() => void update($, hidden, () => true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <Text dimColor>Not an AIDLC workspace: no .claude/aidlc.config.json in this folder.</Text>
    if (snap.problem) return <Text color="warning">{snap.problem}</Text>
    const rows = snap.sprint?.rows ?? []
    return (
      <Box flexDirection="column" gap="sm">
        <Box flexDirection="column">
          <Text weight="bold">{snap.runs.length ? `Runs (${snap.runs.length})` : 'No runs in flight'}</Text>
          {snap.runs.map(run => {
            const line = runLine(run, snap.costs?.[run.item])
            return <Text color={line.tone === 'warning' ? 'warning' : 'text'}>{line.text}</Text>
          })}
        </Box>
        {rows.length > 0 && (
          <Box flexDirection="column">
            <Text weight="bold">{`Sprint (${rows.length})`}</Text>
            {rows.map(row => (
              <Box flexDirection="row" gap="sm">
                <Text color={row.needsYou && !row.terminal ? 'warning' : row.terminal ? 'success' : 'text'}>
                  {`${row.item} · ${row.phase ?? '—'} · ${row.waitingFor ? `${row.status} (${row.waitingFor})` : row.status}`}
                </Text>
                {row.session && row.needsYou && !row.terminal && (
                  <Button
                    key={`attach-${row.item}`}
                    label="Copy attach command"
                    onPress={press => void $.ui.copy({ text: `claude attach ${row.session}`, surface: press.surface })}
                  />
                )}
              </Box>
            ))}
          </Box>
        )}
        <Text dimColor>{`Updated ${clockTime(snap.at)} · costs are API-equivalent (/cost) · /${COMMAND} to refresh`}</Text>
      </Box>
    )
  })
}
