// aidlc-cockpit — AIDLC beside the chat.
//
// It gates no tool call, rewrites no prompt and approves nothing. What it shows comes from core's
// scripts (run-files.mjs, sprint.mjs, costs.mjs, brain.mjs context, work-items/tree.mjs), found next to
// this plugin, so it can never disagree with /aidlc:status, /aidlc:sprint or the brain. What this session
// changed it keeps itself, as the tools run. What to show is decided in view.mjs; this file gathers and
// draws.
//
// The one thing it writes is the cost ledger: what each work item cost, by phase, from Claude Code's own
// session cost (view.mjs → *the cost ledger*). One file per item per session, under the main checkout's
// git-ignored `.aidlc/logs/costs/`.
//
// Cost: no model calls, ever. A board refresh runs a few short `node` and `git` processes, every 30
// seconds and only while a surface is drawing, so an unattended background sprint run polls nothing. A
// remote board (Azure DevOps) is read every five minutes, or when the person asks with /aidlc-board.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitBoardRow, CockpitContext, CockpitGit, CockpitRun, CockpitSnapshot, CockpitSprint, CockpitTree } from '../types'
import type { Charge, Ledger, LedgerFile } from './view.mjs'
import {
  advance,
  bandModel,
  boardText,
  cacheDirOf,
  checksIn,
  commandItem,
  contextModel,
  coreCandidates,
  coreTooOld,
  editedPath,
  ledgerName,
  makesCommit,
  mergeLedger,
  newestSprintFile,
  PARKED_KEY,
  noteChecks,
  noteCommit,
  noteEdit,
  parseGitStatus,
  phaseOf,
  repoOf,
  repoRoots,
  runFileTarget,
  runsModel,
  sessionModel,
  toSlash,
  transitions,
  treeModel,
  workspacePath,
} from './view.mjs'

const PANE = 'aidlc-board'
const COMMAND = 'aidlc-board'
const POLL_MS = 30_000
const FLUSH_MS = 120_000
const MIN_GAP_MS = 5_000
// A remote board changes on people's time, and each look is a call to the tracker.
const TREE_MS = 300_000
const MAX_RECENT_FILES = 40
// The oldest core this cockpit reads correctly: brain.mjs context and work-items/tree.mjs (0.71),
// costs.mjs (0.65), run-files --json (0.64).
const MIN_CORE = '0.71.0'

// Change the shape tag when a value's fields change: a reload keeps $.state, and the tag makes the new
// code decline what the old code stored instead of misreading it.
const snapshot = atom({ plugin: 'aidlc-cockpit', key: 'snapshot' } as const, null, { shape: 'snapshot-5' })
const hidden = atom({ plugin: 'aidlc-cockpit', key: 'hidden' } as const, false)
const work = atom({ plugin: 'aidlc-cockpit', key: 'work' } as const, { files: {}, checks: {}, commits: 0 }, { shape: 'work-1' })
const toggled = atom({ plugin: 'aidlc-cockpit', key: 'toggled' } as const, {} as Record<string, boolean>)

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
let coreVersion: string | null | undefined
let tree: CockpitTree | null = null
let treeAt = 0
let context: CockpitContext | null = null
let contextFor = ''

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

async function readCoreVersion($: EngineInterface, dir: string): Promise<string | null> {
  try {
    const v = (JSON.parse(await $.fs.read(`${dir}/.claude-plugin/plugin.json`)) as { version?: unknown }).version
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
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

async function readConfig($: EngineInterface, cwd: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(`${cwd}/.claude/aidlc.config.json`))
  } catch {
    return null
  }
}

async function gitStatus($: EngineInterface, dir: string, key: string, cwd: string): Promise<CockpitGit | null> {
  try {
    const r = await $.process.run(['git', '-C', dir, 'status', '--porcelain=v1', '--branch', '-z', '--untracked-files=all'], { cwd, timeoutMs: 10_000 })
    return r.exitCode === 0 ? parseGitStatus(r.stdout, key) : null
  } catch {
    return null
  }
}

// What a finished tool call changed: a file an edit wrote, a check a shell command ran and whether it
// passed, a commit. A refused or failed edit changed nothing.
async function noteWork(
  $: EngineInterface,
  call: { tool: string; file_path?: unknown; notebook_path?: unknown; command?: unknown },
  ran: { deny?: string; isError?: true },
): Promise<void> {
  const edited = editedPath(call.tool, call)
  if (ran.deny || (!edited && call.tool !== 'Bash' && call.tool !== 'PowerShell')) return
  const now = await $.clock.now()
  if (edited) {
    const path = ran.isError ? null : workspacePath(toSlash(await $.session.cwd()), edited)
    if (path) await update($, work, w => noteEdit(w, path, now))
    return
  }
  const command = String(call.command ?? '')
  const kinds = checksIn(command)
  if (kinds.length) await update($, work, w => noteChecks(w, kinds, !ran.isError, now))
  if (!ran.isError && makesCommit(command)) await update($, work, w => noteCommit(w))
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
    // An older core is missing scripts this cockpit reads, which would show as an empty board.
    if (coreVersion === undefined) coreVersion = await readCoreVersion($, core)
    if (coreTooOld(coreVersion, MIN_CORE)) {
      const problem = `this cockpit needs aidlc ${MIN_CORE} or later (found ${coreVersion ?? 'an unknown version'}) — /plugin marketplace update aidlc`
      await update($, snapshot, () => ({ runs: [], sprint: null, at: now, problem }))
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

    // What this session changed: git for each repo holding one of its files, and for the workspace.
    const cfg = await readConfig($, cwd)
    const w = await read($, work)
    const recent = Object.entries(w.files)
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p)
      .slice(0, MAX_RECENT_FILES)
    const roots = repoRoots(cfg, cwd)
    const wanted = new Map<string, { key: string; dir: string }>()
    for (const p of recent) {
      const r = repoOf(roots, p)
      if (r && r.key !== '.') wanted.set(r.key, r)
    }
    const git: CockpitGit[] = []
    for (const r of [...[...wanted.values()].slice(0, 4), roots[roots.length - 1]]) {
      const g = await gitStatus($, r.dir, r.key, cwd)
      if (g) git.push(g)
    }

    // The modules those files are in: looked up again only when the files change.
    const key = recent.join('\n')
    if (!recent.length) context = null
    else if (force || key !== contextFor) {
      contextFor = key
      context = (await nodeJson($, [`${core}/skills/brain/brain.mjs`, 'context', cwd, ...recent, '--json'], cwd)) as CockpitContext | null
    }

    // The board as a tree: a markdown backlog every look, a remote board every few minutes.
    if (force || !tree || tree.source === 'markdown' || now - treeAt >= TREE_MS) {
      treeAt = now
      const t = (await nodeJson($, [`${core}/skills/work-items/tree.mjs`, cwd, '--json'], cwd)) as CockpitTree | null
      if (t) tree = t
    }

    // PRs /aidlc:status has seen merged or closed: a run still parked behind one has cleanup waiting.
    let settled: CockpitSnapshot['settled'] = {}
    try {
      settled = JSON.parse(await $.fs.read(`${cwd}/.aidlc/logs/pr-state.json`)) as CockpitSnapshot['settled']
    } catch {
      // no PR has settled yet, or /aidlc:status has not looked
    }

    const snap: CockpitSnapshot = { runs, sprint, costs, context, git, tree, settled, at: now, problem: null }
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

  // The pipeline writes the run file at every phase change, and every edit, check and commit is this
  // session's work. The call itself always goes ahead untouched.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool: string; command?: unknown; file_path?: unknown; notebook_path?: unknown }
    const target = runFileTarget(String(e.tool), call)
    const ran = await next(e)
    if (target) {
      try {
        await noteRunFile($, target)
      } catch {
        // the ledger is best-effort; the tool call already happened
      }
    }
    try {
      await noteWork($, { ...call, tool: String(e.tool) }, ran)
    } catch {
      // the board is best-effort too
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
    return { text: boardText(await read($, snapshot), await read($, work), await read($, toggled)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    const band = bandModel(await read($, snapshot), await read($, work))
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
    const open = await read($, toggled)
    const here = contextModel(snap.context)
    const session = sessionModel(await read($, work), snap.git, snap.context, snap.tree)
    const board = treeModel(snap.tree, open)
    const runs = runsModel(snap, open)
    return (
      <Box flexDirection="column" gap="sm">
        {here.map(m => (
          <Box flexDirection="column">
            <Box flexDirection="row" gap="sm">
              <Text weight="bold">{m.title}</Text>
              {m.learn && (
                <Button
                  key={`learn-${m.name}`}
                  label={`Put ${m.learn} in prompt`}
                  onPress={() => void $.prompt.fill({ text: m.learn ?? '', mode: 'replace' }).catch(() => $.ui.toast(`Type ${m.learn} to run it`))}
                />
              )}
            </Box>
            {m.lines.map(l => (
              <Text color={l.tone} wrap="truncate-end">
                {l.text}
              </Text>
            ))}
          </Box>
        ))}
        <Box flexDirection="column">
          <Text weight="bold">{session.title}</Text>
          {session.lines.map(l => (
            <Text color={l.tone} wrap="truncate-end">
              {l.text}
            </Text>
          ))}
        </Box>
        {board && (
          <Box flexDirection="column">
            <Text weight="bold">{board.title}</Text>
            {[...board.rows, ...(board.loose.length ? [null] : []), ...board.loose].map(r =>
              r === null ? (
                <Text weight="bold">Not under an epic</Text>
              ) : (
                <Box flexDirection="row" gap="sm">
                  <Text color={r.tone} wrap="truncate-end">
                    {r.text}
                  </Text>
                  {r.expandable && (
                    <Button key={`tree-${r.id}`} label={r.open ? 'Close' : 'Open'} onPress={() => void update($, toggled, t => ({ ...t, [r.id]: !r.open }))} />
                  )}
                </Box>
              ),
            )}
            {board.note && <Text dimColor>{board.note}</Text>}
          </Box>
        )}
        {runs && (
          <Box flexDirection="column">
            <Text weight="bold">{runs.title}</Text>
            {runs.lines.map(l => (
              <Text color={l.tone === 'warning' ? 'warning' : 'text'} wrap="truncate-end">
                {l.text}
              </Text>
            ))}
            {runs.parked && (
              <Box flexDirection="row" gap="sm">
                <Text color={runs.parked.tone === 'warning' ? 'warning' : 'subtle'} wrap="truncate-end">
                  {runs.parked.text}
                </Text>
                <Button key="runs-parked" label={runs.open ? 'Close' : 'Open'} onPress={() => void update($, toggled, t => ({ ...t, [PARKED_KEY]: !runs.open }))} />
              </Box>
            )}
            {runs.parked &&
              runs.open &&
              runs.parkedLines.map(l => (
                <Text color={l.tone === 'warning' ? 'warning' : 'subtle'} wrap="truncate-end">
                  {`  ${l.text}`}
                </Text>
              ))}
          </Box>
        )}
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
        <Text dimColor>{`Updated ${clockTime(snap.at)}${snap.runs.length ? ' · costs are API-equivalent (/cost)' : ''} · /${COMMAND} to refresh`}</Text>
      </Box>
    )
  })
}
