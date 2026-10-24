// aidlc-cockpit — AIDLC beside the chat.
//
// It only ever READS: it gates no tool call, rewrites no prompt, approves nothing. What it shows comes
// from core's scripts (run-files.mjs, sprint.mjs), found next to this plugin, so it can never disagree
// with /aidlc:status or /aidlc:sprint. What to show is decided in view.mjs; this file gathers and draws.
//
// Cost: no model calls, ever. A refresh runs at most two short `node` processes. It runs every 30
// seconds only while a surface is drawing, so a background sprint run with no terminal polls nothing,
// and after each turn of the main conversation.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CockpitBoardRow, CockpitRun, CockpitSnapshot, CockpitSprint } from '../types'
import { bandModel, boardText, cacheDirOf, coreCandidates, newestSprintFile, runLine, toSlash, transitions } from './view.mjs'

const PANE = 'aidlc-board'
const COMMAND = 'aidlc-board'
const POLL_MS = 30_000
const MIN_GAP_MS = 5_000

// Change the shape tag when the snapshot's fields change: a reload keeps $.state, and the tag makes
// the new code decline what the old code stored instead of misreading it.
const snapshot = atom({ plugin: 'aidlc-cockpit', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const hidden = atom({ plugin: 'aidlc-cockpit', key: 'hidden' } as const, false)

const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Module variables start over on a reload; that is fine for all four.
let core: string | null | undefined // undefined: not looked for yet; null: not found
let lastRows: CockpitBoardRow[] | null = null
let busy = false
let lastAt = 0

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

    for (const t of transitions(lastRows, sprint?.rows ?? null)) {
      void $.ui.notify(t.text, { title: 'AIDLC sprint' })
      $.ui.toast(t.text)
    }
    lastRows = sprint?.rows ?? null
    const snap: CockpitSnapshot = { runs, sprint, at: now, problem: null }
    await update($, snapshot, () => snap)
  } finally {
    busy = false
  }
}

// The timer's tick: look again only while something is drawing.
async function poll($: EngineInterface): Promise<void> {
  if ((await $.session.surfaces()).length) await refresh($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A `claude -p` or SDK session draws nothing, so there is nothing to keep fresh.
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

  // Run files change during turns: look again when the main conversation's turn ends.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) $.clock.after(250, () => void refresh($))
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
            const line = runLine(run)
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
        <Text dimColor>{`Updated ${clockTime(snap.at)} · /${COMMAND} to refresh`}</Text>
      </Box>
    )
  })
}
