import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, RenderElement, RenderInput, Timer } from 'claude-code'

import type { Detail, DayStats, Doll, Stats, UsageSnap, View } from '../types'
import { MAIN, STATUS, toDoll, toLines } from './lib/agents'
import {
  bar, cacheColor, cacheRate, clip, compactHint, countdown, duration, effortColor, kt, lineCount, modelName,
  plural, today, topCounts, usageColor,
} from './lib/format'
import { basename, parseNumstat, parseStatus } from './lib/git'
import { miniRobot, robot } from './lib/robot'
import { EMPTY_STATS, same } from './lib/state'
import type { GitInfo } from '../types'

// $ may only be passed to functions declared in this file, so everything that
// talks to the engine lives here; lib/ holds the pure parts (formatting, parsing).

// ── state ──

const PANE = 'claudebar'

const git = atom({ plugin: 'claudebar-mod', key: 'git' } as const, null)
const usage = atom({ plugin: 'claudebar-mod', key: 'usage' } as const, null)
const stats = atom({ plugin: 'claudebar-mod', key: 'stats' } as const, EMPTY_STATS)
const view = atom({ plugin: 'claudebar-mod', key: 'view' } as const, 'context')
const isMainBusy = atom({ plugin: 'claudebar-mod', key: 'isMainBusy' } as const, false)
const dolls = atom({ plugin: 'claudebar-mod', key: 'dolls' } as const, [])
const selected = atom({ plugin: 'claudebar-mod', key: 'selected' } as const, null)
const detail = atom({ plugin: 'claudebar-mod', key: 'detail' } as const, null)
const history = atom({ plugin: 'claudebar-mod', key: 'history' } as const, [])
const alerted = atom({ plugin: 'claudebar-mod', key: 'alerted' } as const, [])
const frame = atom({ plugin: 'claudebar-mod', key: 'frame' } as const, 0)

// ── git ──

async function runGit($: EngineInterface, cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 3000 })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function readGit($: EngineInterface): Promise<GitInfo> {
  const cwd = await $.session.cwd()
  const dir = basename(cwd)
  const status = await runGit($, cwd, ['status', '--porcelain=v1', '--branch'])
  if (status === null) {
    return {
      dir, isRepo: false, branch: null, isDirty: false, modified: 0, ahead: 0, added: 0,
      removed: 0, lastSubject: null, worktree: null, files: [], commits: [],
    }
  }
  const [numstat, log, dirs] = await Promise.all([
    runGit($, cwd, ['diff', 'HEAD', '--numstat']),
    runGit($, cwd, ['log', '-5', '--format=%h %s']),
    runGit($, cwd, ['rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir']),
  ])
  const { branch, ahead, files } = parseStatus(status)
  const { added, removed } = parseNumstat(numstat ?? '')
  const commits = (log ?? '').split('\n').filter(Boolean)
  const [top, gitDir, commonDir] = (dirs ?? '').split('\n')
  const isWorktree = !!gitDir && !!commonDir && gitDir !== commonDir && gitDir.includes('/worktrees/')

  return {
    dir,
    isRepo: true,
    branch,
    isDirty: files.length > 0 || ahead > 0,
    modified: files.length,
    ahead,
    added,
    removed,
    lastSubject: commits[0]?.replace(/^\S+ /, '') ?? null,
    worktree: isWorktree && top ? basename(top) : null,
    files,
    commits,
  }
}

// ── agents ──

async function refreshAgents($: EngineInterface) {
  const next = (await $.agent.list()).map(toDoll)
  if (!same(next, await read($, dolls))) await update($, dolls, () => next)
  // Only a working robot animates, so only then is it worth a redraw.
  const isAnyWorking = (await read($, isMainBusy)) || next.some(d => d.status === 'running')
  if (isAnyWorking) await update($, frame, n => n + 1)

  const id = await read($, selected)
  if (id === null || id === MAIN) return
  const answer = await $.session.messages({ agentId: id })
  const fresh: Detail = Array.isArray(answer)
    ? { agentId: id, lines: toLines(answer) }
    : { agentId: id, lines: (await read($, detail))?.lines ?? [], deny: answer.deny }
  if (!same(fresh, await read($, detail))) await update($, detail, () => fresh)
}

async function selectAgent($: EngineInterface, doll: Doll | null) {
  const isSame = doll !== null && (await read($, selected)) === doll.id
  if (doll === null || isSame) {
    await update($, selected, () => MAIN)
    await update($, detail, () => null)
    return
  }
  await update($, selected, () => doll.id)
  await update($, detail, () => ({ agentId: doll.id, lines: [] }))
  await refreshAgents($)
}

// ── band ──


// The press must await the open: a pane opened after the press has settled
// counts as opened unasked, and on a terminal under 144 columns it waits undrawn.
async function openPane($: EngineInterface, next: View) {
  const opened = await $.ui.open({ id: PANE, title: 'claudebar', focus: true })
  await update($, view, () => next)
  if (!opened.isPlaced) {
    $.ui.toast(`The claudebar pane is open but cannot be shown: ${opened.reason}`, { timeoutMs: 8000 })
    return
  }
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (pane && !pane.isShown) {
    $.ui.toast('The claudebar pane is open as a tab behind another pane: press its tab or ctrl+x tab.', { timeoutMs: 8000 })
  }
}

async function compactNow($: EngineInterface) {
  $.ui.toast('Compacting the conversation…')
  const result = await $.session.compact()
  if ('skip' in result && result.skip) $.ui.toast(`Not compacted: ${result.skip}`)
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  seven_day_sonnet: '7d sonnet',
}

async function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, options: PluginOptions) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const g = await read($, git)
  const u = await read($, usage)
  const s = await read($, stats)
  const agentList = await read($, dolls)
  const columns = e.props.bodyColumns
  const rows: RenderElement[] = []
  const now = u?.now ?? 0
  const hit = cacheRate(s.lastTurn)
  const link = (key: string, label: string, onPress: () => unknown) => (
    <Button key={key} label={label} onPress={() => onPress()} />
  )

  // Line 1: directory, branch and changes.
  if (options.showGit !== false && g) {
    const branchColor = g.isDirty ? 'yellow' : 'green'
    const used = g.dir.length + (g.branch?.length ?? 0) + 40
    rows.push(
      <Box key="l-git" flexDirection="row" gap={1}>
        <Text bold>{g.dir}</Text>
        {g.isRepo && (
          <Text color={branchColor}>
            ({g.branch ?? '?'}
            {g.modified > 0 ? ` mod:${g.modified}` : ''}
            {g.ahead > 0 ? ` ahead:${g.ahead}` : ''})
          </Text>
        )}
        {g.isRepo && (g.added > 0 || g.removed > 0) && (
          <Text>
            <Text color="green">+{g.added}</Text> <Text color="red">-{g.removed}</Text>
          </Text>
        )}
        {g.worktree && <Text color="magenta">[worktree: {g.worktree}]</Text>}
        {g.lastSubject && columns - used > 12 && (
          <Text dimColor wrap="truncate-end">last: {clip(g.lastSubject, columns - used)}</Text>
        )}
        {g.isRepo && link('open-git', 'Git ›', () => openPane($, 'git'))}
      </Box>,
    )
  }

  // Line 2: model, effort, context and the compact hint.
  if (options.showModel !== false) {
    const ctx = u?.ctxPercent ?? null
    const minutes = u ? (now - u.startedAt) / 60000 : 0
    const hint = ctx === null ? null : compactHint(ctx, hit, minutes)
    rows.push(
      <Box key="l-model" flexDirection="row" gap={1}>
        <Text bold>{s.model ? modelName(s.model) : '…'}</Text>
        {s.effort && <Text color={effortColor(s.effort)}>⚙ {s.effort}</Text>}
        {ctx !== null && (
          <Text>
            ctx <Text color={usageColor(ctx)}>{bar(ctx)}</Text> {Math.round(ctx)}%
          </Text>
        )}
        {u?.ctxTokens != null && <Text dimColor>←{kt(u.ctxTokens)} →{kt(s.outputTokens)}</Text>}
        {hint && hint.score >= 2 && (
          <Button key="compact" label={`${hint.label} now`} variant="primary" onPress={() => compactNow($)} />
        )}
        {hint && hint.score < 2 && <Text color={hint.color}>{hint.label}</Text>}
        {link('open-context', 'Context ›', () => openPane($, 'context'))}
      </Box>,
    )
  }

  // Line 3: subscription rate limits.
  if (options.showLimits !== false && u && u.limits.length > 0) {
    rows.push(
      <Box key="l-limits" flexDirection="row" gap={2}>
        {u.limits.map(l => {
          const left = countdown(l.resetsAt, now)
          return (
            <Text key={`limit-${l.kind}`}>
              {LIMIT_LABELS[l.kind] ?? l.kind} <Text color={usageColor(l.percent)}>{bar(l.percent)}</Text>{' '}
              {Math.round(l.percent)}%{left ? ` (${left})` : ''}
            </Text>
          )
        })}
      </Box>,
    )
  }

  // Line 4: duration, cache, lines edited and cost.
  if (options.showStats !== false && u) {
    rows.push(
      <Box key="l-stats" flexDirection="row" gap={1}>
        <Text>⏱ {duration(now - u.startedAt)}</Text>
        {hit !== null && (
          <Text>
            cache <Text color={cacheColor(hit)}>{bar(hit)}</Text> {hit}%
          </Text>
        )}
        {(s.added > 0 || s.removed > 0) && (
          <Text>
            edited <Text color="green">+{s.added}</Text> <Text color="red">-{s.removed}</Text>
          </Text>
        )}
        {u.costUsd !== null && <Text dimColor>${u.costUsd.toFixed(2)}</Text>}
        {link('open-history', 'History ›', () => openPane($, 'history'))}
      </Box>,
    )
  }

  // Line 5: tools.
  const tools = topCounts(s.tools, 10)
  if (options.showTools !== false && tools.length > 0) {
    rows.push(
      <Box key="l-tools" flexDirection="row" gap={1}>
        <Text wrap="truncate-end">
          Tools: {tools.map(([name, n]) => `${name}×${n}`).join(' ')}
        </Text>
        {link('open-tools', 'Tools ›', () => openPane($, 'tools'))}
      </Box>,
    )
  }

  // Line 6: agents and skills.
  const agents = topCounts(s.agents, 6)
  const running = agentList.filter(a => a.status === 'running' || a.status === 'pending').length
  if (options.showAgents !== false && (agents.length > 0 || s.skills.length > 0 || agentList.length > 0)) {
    rows.push(
      <Box key="l-agents" flexDirection="row" gap={1}>
        {agents.length > 0 && (
          <Text wrap="truncate-end">
            Agents: <Text color="yellow">{agents.map(([name, n]) => `${name}×${n}`).join(' ')}</Text>
          </Text>
        )}
        {running > 0 && <Text color={STATUS.running!.color}>● {running} active</Text>}
        {s.skills.length > 0 && (
          <Text wrap="truncate-end">
            Skills: <Text color="cyan">{s.skills.join(' ')}</Text>
          </Text>
        )}
        {link('open-agents', 'Agents ›', () => openPane($, 'agents'))}
      </Box>,
    )
  }

  // A dim rule above the band, so it reads apart from the conversation above it.
  if (rows.length > 0 && options.showSeparator !== false) {
    rows.unshift(
      <Text key="separator" dimColor>
        {'─'.repeat(Math.max(1, columns))}
      </Text>,
    )
  }

  return <Box flexDirection="column">{rows}</Box>
}

// ── pane ──

const TABS: Array<[View, string]> = [
  ['context', 'Context'],
  ['tools', 'Tools'],
  ['git', 'Git'],
  ['agents', 'Agents'],
  ['history', 'History'],
]

type PaneEvent = RenderInput<'Pane'>
type Els = ReturnType<EngineInterface['ui']['resolve']>

async function renderPane($: EngineInterface, e: PaneEvent) {
  const els = $.ui.resolve(e)
  const { Box, Button } = els
  const current = await read($, view)
  const columns = e.props.bodyColumns
  const rows = e.props.scroll.bodyRows

  const body =
    current === 'context' ? await contextView($, els, columns)
    : current === 'tools' ? await toolsView($, els, columns)
    : current === 'git' ? await gitView($, els, columns)
    : current === 'agents' ? await agentsView($, els, e, columns, rows)
    : await historyView($, els, columns)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {TABS.map(([id, label]) => (
          <Button
            key={`tab-${id}`}
            label={label}
            variant={id === current ? 'primary' : 'secondary'}
            onPress={() => update($, view, () => id)}
          />
        ))}
      </Box>
      {body}
    </Box>
  )
}

type CellStyle = { color?: string; dimColor?: boolean; bold?: boolean }

// A fixed-width table cell: it neither shrinks nor wraps, so columns stay
// aligned even in a narrow pane.
function cellOf({ Box, Text }: Els) {
  return (key: string, width: number, text: string, style: CellStyle = {}, isRight = false) => (
    <Box key={key} width={width} flexShrink={0}>
      <Text {...style} wrap="truncate-end">
        {isRight ? text.padStart(width) : text}
      </Text>
    </Box>
  )
}

async function contextView($: EngineInterface, els: Els, columns: number) {
  const { Box, Text, Button } = els
  const cell = cellOf(els)
  const u = await $.session.usage({ breakdown: 'summary', columns })
  const b = u.context.breakdown

  if (!b) return <Text dimColor>No context breakdown yet.</Text>

  const categories = [...b.categories].filter(c => c.tokens > 0 && c.kind !== 'free').sort((x, y) => y.tokens - x.tokens)
  // name · bar · tokens · percent, sized to the pane's width.
  const barWidth = columns >= 44 ? 10 : 6
  const nameWidth = Math.max(8, Math.min(28, columns - barWidth - 16))
  const hasDeferred = categories.some(c => c.isDeferred)
  const threshold = b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{Math.round(b.percentage)}%</Text> of {kt(b.maxTokens)} · {kt(b.totalTokens)} used
      </Text>
      {threshold !== undefined && threshold > 0 && (
        <Text dimColor>
          Autocompact at {kt(threshold)} ({Math.round((threshold / b.maxTokens) * 100)}%)
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {categories.map(c => {
          const pct = b.maxTokens > 0 ? (c.tokens / b.maxTokens) * 100 : 0
          return (
            <Box key={`cat-${c.name}`} flexDirection="row">
              {cell('name', nameWidth + 1, clip(c.name, nameWidth), { dimColor: c.isDeferred })}
              {cell('bar', barWidth + 1, bar(pct, barWidth), { color: c.color })}
              {cell('tokens', 6, kt(c.tokens), { dimColor: true }, true)}
              {cell('pct', 8, `${pct.toFixed(1)}%${c.isDeferred ? '*' : ''}`, { dimColor: true }, true)}
            </Box>
          )
        })}
      </Box>
      {hasDeferred && <Text dimColor>* deferred: loaded only when used</Text>}
      {b.memoryFiles.length > 0 && (
        <Text dimColor wrap="truncate-end">
          Memory: {b.memoryFiles.map(f => `${clip(f.path.split('/').pop() ?? f.path, 24)} ${kt(f.tokens)}`).join(' · ')}
        </Text>
      )}
      {b.mcpTools.length > 0 && <Text dimColor>MCP tools: {b.mcpTools.length}</Text>}
      <Box marginTop={1}>
        <Button key="compact-pane" label="Compact now" variant="primary" onPress={() => compactNow($)} />
      </Box>
    </Box>
  )
}

function countList(els: Els, title: string, counts: Record<string, number>, color: string, columns: number) {
  const { Box, Text } = els
  const cell = cellOf(els)
  const list = topCounts(counts, 100)
  if (list.length === 0) return null
  const max = list[0]![1]
  const barWidth = columns >= 40 ? 10 : 6
  const nameWidth = Math.max(8, Math.min(30, columns - barWidth - 8))
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {list.map(([name, n]) => (
        <Box key={`${title}-${name}`} flexDirection="row">
          {cell('name', nameWidth + 1, clip(name, nameWidth))}
          {cell('bar', barWidth + 1, bar((n / max) * 100, barWidth), { color })}
          {cell('n', 5, String(n), { dimColor: true }, true)}
        </Box>
      ))}
    </Box>
  )
}

async function toolsView($: EngineInterface, els: Els, columns: number) {
  const { Box, Text } = els
  const s = await read($, stats)
  const isEmpty = Object.keys(s.tools).length === 0 && Object.keys(s.subagentTools).length === 0

  return (
    <Box flexDirection="column" gap={1}>
      {isEmpty && <Text dimColor>No tools used yet.</Text>}
      {countList(els, 'Main agent', s.tools, 'cyan', columns)}
      {countList(els, 'Subagents', s.subagentTools, 'magenta', columns)}
      {countList(els, 'Agents launched', s.agents, 'yellow', columns)}
      {s.skills.length > 0 && (
        <Text>
          <Text bold>Skills: </Text>
          <Text color="cyan">{s.skills.join(' · ')}</Text>
        </Text>
      )}
      <Text dimColor>
        {plural(s.turns, 'turn')} · {kt(s.outputTokens)} output · {plural(s.compactions, 'compaction')}
      </Text>
    </Box>
  )
}

const FILE_COLORS: Record<string, string> = { M: 'yellow', A: 'green', D: 'red', R: 'cyan', '??': 'gray' }

async function gitView($: EngineInterface, { Box, Text }: Els, columns: number) {
  const g = await read($, git)
  if (!g || !g.isRepo) return <Text dimColor>This directory is not a git repository.</Text>

  return (
    <Box flexDirection="column" gap={1}>
      <Text>
        <Text bold>{g.dir}</Text> <Text color={g.isDirty ? 'yellow' : 'green'}>{g.branch ?? '?'}</Text>
        {g.ahead > 0 ? `  ${plural(g.ahead, 'unpushed commit')}` : ''}
        {g.worktree ? `  [worktree: ${g.worktree}]` : ''}
      </Text>
      <Box flexDirection="column">
        <Text bold>
          Changes ({g.files.length}) <Text color="green">+{g.added}</Text> <Text color="red">-{g.removed}</Text>
        </Text>
        {g.files.length === 0 && <Text dimColor>No changes.</Text>}
        {g.files.slice(0, 40).map(f => (
          <Text key={`file-${f.path}`} wrap="truncate-start">
            <Text color={FILE_COLORS[f.status] ?? 'yellow'}>{f.status.padEnd(2)}</Text> {f.path}
          </Text>
        ))}
        {g.files.length > 40 && <Text dimColor>… and {g.files.length - 40} more</Text>}
      </Box>
      <Box flexDirection="column">
        <Text bold>Recent commits</Text>
        {g.commits.map(c => (
          <Text key={`commit-${c}`} wrap="truncate-end">
            <Text color="yellow">{c.slice(0, c.indexOf(' '))}</Text> {clip(c.slice(c.indexOf(' ') + 1), columns - 10)}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

async function agentsView($: EngineInterface, { Box, Text, Button }: Els, e: PaneEvent, columns: number, rows: number) {
  const list = await read($, dolls)
  const current = (await read($, selected)) ?? MAIN
  const shown = await read($, detail)
  const viewed = e.props.view.agentId ?? MAIN
  const tick = await read($, frame)
  const main: Doll = {
    id: MAIN,
    type: 'main',
    description: 'Main agent',
    status: (await read($, isMainBusy)) ? 'running' : 'idle',
  }
  const width = Math.max(12, columns - 6)
  const depth = (d: Doll): number =>
    d.parentId ? 1 + depth(list.find(p => p.id === d.parentId) ?? { ...d, parentId: undefined }) : 1
  const agents = [main, ...list]
  const room = Math.max(3, rows - agents.length - 8)
  const isCompact = shown !== null
  const owner = shown ? list.find(d => d.id === shown.agentId) : undefined

  return (
    <Box flexDirection="column" gap={isCompact ? 0 : 1}>
      {agents.map(d => {
        const s = STATUS[d.status] ?? { label: d.status, color: 'gray' }
        const isCurrent = d.id === current
        const indent = d.id === MAIN ? 0 : Math.min(depth(d), 3) * 2
        const pick = (
          <Button
            key={`pick-${d.id}`}
            label={d.id === MAIN ? 'Main' : d.type}
            variant={isCurrent ? 'primary' : 'secondary'}
            onPress={() => selectAgent($, d.id === MAIN ? null : d)}
          />
        )
        const state = (
          <Text color={s.color}>
            {isCurrent ? '▶ ' : ''}
            {s.label}
            {d.id === viewed ? ' · 👁 on screen' : ''}
          </Text>
        )

        if (isCompact) {
          const mini = miniRobot(d.type, d.status, tick)
          return (
            <Box key={`doll-${d.id}`} flexDirection="row" gap={1} marginLeft={indent}>
              <Text color={mini.color} dimColor={mini.isDim} bold={isCurrent}>{mini.rows[0]}</Text>
              {pick}
              {state}
            </Box>
          )
        }

        const bot = robot(d.type, d.status, tick)
        return (
          <Box key={`doll-${d.id}`} flexDirection="row" gap={1} marginLeft={indent}>
            <Box flexDirection="column" flexShrink={0}>
              {bot.rows.map((row, i) => (
                <Text key={`r${i}`} color={bot.color} dimColor={bot.isDim} bold={isCurrent}>
                  {row}
                </Text>
              ))}
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {pick}
              <Text dimColor wrap="truncate-end">{clip(d.description, width - 14)}</Text>
              {state}
            </Box>
          </Box>
        )
      })}
      {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
      {shown && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{'─'.repeat(Math.max(4, columns - 2))}</Text>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              <Text color={miniRobot(owner?.type ?? '', owner?.status ?? 'idle', tick).color}>
                {miniRobot(owner?.type ?? '', owner?.status ?? 'idle', tick).rows[0]}
              </Text>
              <Text bold wrap="truncate-end">{clip(owner?.description ?? 'Subagent', width - 16)}</Text>
            </Box>
            <Button key="back" label="Close" role="dismiss" onPress={() => selectAgent($, null)} />
          </Box>
          {shown.deny && <Text color="yellow">{clip(shown.deny, width * 2)}</Text>}
          {shown.lines.length === 0 && !shown.deny && <Text dimColor>Loading…</Text>}
          {shown.lines.slice(-room).map((line, i) =>
            line.role === 'tool' ? (
              <Text key={`ln-${i}`} color={line.isError ? 'red' : 'gray'} wrap="truncate-end">
                › {clip(line.text, width)}
              </Text>
            ) : (
              <Text key={`ln-${i}`} color={line.role === 'user' ? 'cyan' : undefined} wrap="wrap">
                {line.role === 'user' ? '» ' : ''}
                {clip(line.text, width * 3)}
              </Text>
            ),
          )}
        </Box>
      )}
    </Box>
  )
}

async function historyView($: EngineInterface, els: Els, columns: number) {
  const { Box, Text } = els
  const cell = cellOf(els)
  const days = (await read($, history)).slice(-14)
  if (days.length === 0) return <Text dimColor>No history yet: it is saved at the end of each turn.</Text>

  const max = Math.max(1, ...days.map(d => d.outputTokens))
  // day · bar · tokens · sessions · turns · tools · compact = 6 + bar + 34;
  // a narrow pane drops turns and tools (6 + bar + 20).
  const isNarrow = columns < 50
  const barWidth = Math.max(4, Math.min(20, columns - (isNarrow ? 27 : 41)))
  const totals = days.reduce(
    (t, d) => ({ s: t.s + d.sessions, o: t.o + d.outputTokens, c: t.c + d.compactions }),
    { s: 0, o: 0, c: 0 },
  )
  type Cell = [number, string, CellStyle?, boolean?]
  const row = (key: string, cells: Cell[]) => (
    <Box key={key} flexDirection="row">
      {cells
        .filter((_, i) => !isNarrow || (i !== 4 && i !== 5))
        .map(([w, text, style, isRight], i) => cell(`c${i}`, w, text, style, isRight))}
    </Box>
  )
  const dim = { dimColor: true }

  return (
    <Box flexDirection="column">
      {row('head', [
        [6, 'day', dim], [barWidth + 1, 'output', dim], [6, 'tokens', dim, true], [5, 'sess', dim, true],
        [7, 'turns', dim, true], [7, 'tools', dim, true], [8, 'compact', dim, true],
      ])}
      {days.map(d =>
        row(`day-${d.date}`, [
          [6, d.date.slice(5)],
          [barWidth + 1, bar((d.outputTokens / max) * 100, barWidth), { color: 'cyan' }],
          [6, kt(d.outputTokens), {}, true],
          [5, String(d.sessions), dim, true],
          [7, String(d.turns), dim, true],
          [7, String(d.toolCalls), dim, true],
          [8, String(d.compactions), dim, true],
        ]),
      )}
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          {plural(days.length, 'day')} · {plural(totals.s, 'session')} · {kt(totals.o)} output ·{' '}
          {plural(totals.c, 'compaction')}
        </Text>
      </Box>
    </Box>
  )
}

// ── events ──

// As in claudebar: these are counted elsewhere (agents, skills) or add nothing.
const META_TOOLS = new Set(['Agent', 'Task', 'Skill', 'ToolSearch'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const GIT_TOUCHING = new Set([...EDIT_TOOLS, 'Bash'])

const CONTEXT_ALERTS = [70, 85, 95]
const LIMIT_ALERTS = [80, 95]
const HISTORY_DAYS = 30

const VIEW_ARGS: Record<string, View> = {
  context: 'context', ctx: 'context',
  tools: 'tools',
  git: 'git',
  agents: 'agents',
  history: 'history',
}

const EMPTY_DAY = (date: string): DayStats => ({ date, sessions: 0, turns: 0, outputTokens: 0, toolCalls: 0, compactions: 0 })

function bump(counts: Record<string, number>, key: string): Record<string, number> {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 }
}

// Lines an edit adds and removes. At tool.call the tool's arguments sit on the
// event itself (e.old_string), not under e.input.
export function editDelta(tool: string, input: Record<string, unknown>): { added: number; removed: number } {
  if (tool === 'Edit') return { added: lineCount(input.new_string), removed: lineCount(input.old_string) }
  if (tool === 'Write') return { added: lineCount(input.content), removed: 0 }
  if (tool === 'NotebookEdit') return { added: lineCount(input.new_source), removed: 0 }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.reduce(
      (t: { added: number; removed: number }, edit: Record<string, unknown>) => ({
        added: t.added + lineCount(edit.new_string),
        removed: t.removed + lineCount(edit.old_string),
      }),
      { added: 0, removed: 0 },
    )
  }
  return { added: 0, removed: 0 }
}

// Module state: a reload resets it, which is fine for what it holds.
let options: PluginOptions = {}
let toolCallsSinceSave = 0
let gitTimer: Timer | null = null

async function updateStats($: EngineInterface, fn: (s: Stats) => Stats) {
  await update($, stats, fn)
}

async function refreshGit($: EngineInterface) {
  const next = await readGit($)
  if (!same(next, await read($, git))) await update($, git, () => next)
}

function refreshGitSoon($: EngineInterface) {
  gitTimer?.cancel()
  gitTimer = $.clock.after(800, () => void refreshGit($))
}

async function alertOnce($: EngineInterface, key: string, text: string) {
  const done = await read($, alerted)
  if (done.includes(key)) return
  await update($, alerted, list => [...list, key])
  if (options.alerts !== false) $.ui.toast(text, { timeoutMs: 8000 })
}

async function checkAlerts($: EngineInterface, snap: UsageSnap) {
  const ctx = snap.ctxPercent
  if (ctx !== null) {
    // Compacting drops the context: the context alerts re-arm.
    if (ctx < 30) await update($, alerted, list => list.filter(k => !k.startsWith('ctx-')))
    const level = [...CONTEXT_ALERTS].reverse().find(t => ctx >= t)
    if (level !== undefined) {
      const advice = level >= 85 ? 'Compact soon (button in the band, or /compact).' : 'Consider compacting.'
      await alertOnce($, `ctx-${level}`, `Context at ${Math.round(ctx)}%. ${advice}`)
    }
  }
  for (const l of snap.limits) {
    const level = [...LIMIT_ALERTS].reverse().find(t => l.percent >= t)
    if (level === undefined) continue
    const at = l.resetsAt ? new Date(l.resetsAt) : null
    const when = at ? ` Resets at ${at.toTimeString().slice(0, 5)}.` : ''
    await alertOnce($, `limit-${l.kind}-${level}-${l.resetsAt ?? ''}`, `${LIMIT_LABELS[l.kind] ?? l.kind} limit at ${Math.round(l.percent)}%.${when}`)
  }
}

async function refreshUsage($: EngineInterface) {
  const u = await $.session.usage()
  const snap: UsageSnap = {
    ctxPercent: u.context.percent ?? null,
    ctxTokens: u.context.tokens ?? null,
    window: u.context.window,
    limits: u.rateLimits.map(l => ({ kind: l.kind, percent: l.percentUsed, resetsAt: l.resetsAt ?? null })),
    startedAt: u.startedAt,
    costUsd: u.cost?.usd ?? null,
    now: await $.clock.now(),
  }
  await update($, usage, () => snap)
  await checkAlerts($, snap)
}

async function bumpHistory($: EngineInterface, patch: (d: DayStats) => DayStats) {
  const date = today(await $.clock.now())
  const stored = ((await $.store.get('history')) as DayStats[] | undefined) ?? []
  const days = stored.some(d => d.date === date) ? stored : [...stored, EMPTY_DAY(date)]
  const next = days.map(d => (d.date === date ? patch(d) : d)).slice(-HISTORY_DAYS)
  await $.store.set('history', next)
  await update($, history, () => next)
}

async function countSession($: EngineInterface) {
  const date = today(await $.clock.now())
  const id = await $.session.id()
  const key = `sessions:${date}`
  const seen = ((await $.store.get(key)) as string[] | undefined) ?? []
  if (seen.includes(id)) return
  await $.store.set(key, [...seen, id])
  await bumpHistory($, d => ({ ...d, sessions: d.sessions + 1 }))
}

export const register: Register = (on, opts) => {
  options = opts

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'claudebar',
      description: 'Open the claudebar pane (context, tools, git, agents or history)',
      argumentHint: '[context|tools|git|agents|history]',
    })
    const model = await $.session.model()
    await updateStats($, s => ({ ...s, model: s.model ?? model }))
    const stored = ((await $.store.get('history')) as DayStats[] | undefined) ?? []
    await update($, history, () => stored)

    void countSession($)
    void refreshGit($)
    void refreshUsage($)
    void refreshAgents($)
    $.clock.every(1500, () => void refreshAgents($))
    $.clock.every(15000, () => void refreshUsage($))
    $.clock.every(10000, () => void refreshGit($))

    return next(e)
  })

  on('command.run', { command: 'claudebar' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const target = VIEW_ARGS[arg] ?? (await read($, view))
    await openPane($, target)
    return { text: `claudebar pane opened (${target}).` }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, isMainBusy, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await updateStats($, s => (s.model === e.model && s.effort === effort ? s : { ...s, model: e.model, effort }))
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const isMain = e.agentId === undefined
    if (!META_TOOLS.has(tool)) {
      toolCallsSinceSave += 1
      await updateStats($, s =>
        isMain ? { ...s, tools: bump(s.tools, tool) } : { ...s, subagentTools: bump(s.subagentTools, tool) },
      )
    }
    const result = await next(e)
    const isOk = !('deny' in result && result.deny) && result.isError !== true
    if (isOk && EDIT_TOOLS.has(tool)) {
      const { added, removed } = editDelta(tool, e as unknown as Record<string, unknown>)
      await updateStats($, s => ({ ...s, added: s.added + added, removed: s.removed + removed }))
    }
    if (GIT_TOUCHING.has(tool)) refreshGitSoon($)
    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await updateStats($, s => ({ ...s, agents: bump(s.agents, e.subagentType || 'general-purpose') }))
    void refreshAgents($)
    return spawned
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    await updateStats($, s => (s.skills.includes(e.skill) ? s : { ...s, skills: [...s.skills, e.skill] }))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && !('skip' in result && result.skip)) {
      await updateStats($, s => ({ ...s, compactions: s.compactions + 1 }))
      void bumpHistory($, d => ({ ...d, compactions: d.compactions + 1 }))
      void refreshUsage($)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, isMainBusy, () => false)
      const u = e.usage
      const out = u?.output_tokens ?? 0
      await updateStats($, s => ({
        ...s,
        turns: s.turns + 1,
        outputTokens: s.outputTokens + out,
        lastTurn: u
          ? { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheCreation: u.cache_creation_input_tokens }
          : s.lastTurn,
      }))
      const calls = toolCallsSinceSave
      toolCallsSinceSave = 0
      void bumpHistory($, d => ({ ...d, turns: d.turns + 1, outputTokens: d.outputTokens + out, toolCalls: d.toolCalls + calls }))
      void refreshUsage($)
      refreshGitSoon($)
    }
    void refreshAgents($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    return renderBand($, e, options)
  })

  on('ui.render', { component: 'Pane', requestId: 'claudebar' }, ($, e) => renderPane($, e))
}
