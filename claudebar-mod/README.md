# claudebar-mod

[claudebar](https://github.com/visiblesoft-es/claudebar) rebuilt as a Claude Code mod. It shows the same six lines, now in an interactive band above the prompt that keeps itself up to date, and adds detail panes, alerts and history.

```
my-app (main mod:3 ahead:2) +47 -12 last: feat(auth): refresh token rotation [ Git › ]
Opus 5.5 ⚙ high ctx ▓▓▓▓▓▓▓░ 88% ←150kt →52kt [ ⚠ COMPACT now ] [ Context › ]
5h ▓▓░░░░░░ 28% (1h 56m)  7d ▓▓▓░░░░░ 38% (2d 23h)
⏱ 1h 8m cache ▓▓▓▓▓▓▓░ 90% edited +308 -66 $1.50 [ History › ]
Tools: Read×38 Edit×17 Bash×9 [ Tools › ]
Agents: code-reviewer×2 Explore×1 ● 1 active Skills: commit feature-dev [ Agents › ]
```

## Installation

Requires Claude Code with mod support (tested on 2.1.291).

From a Claude Code session in the terminal:

```
/plugin install claudebar-mod --marketplace visiblesoft-es/claude-mods
```

Answer `y` to add the marketplace and pick a scope (the user scope is the first one). No `jq`, no `/claudebar:setup`, no restart: it is active as soon as it is installed.

Or from your shell:

```bash
claude plugin marketplace add visiblesoft-es/claude-mods
claude plugin install claudebar-mod@claude-mods
```

To try it from a local clone, without installing:

```bash
git clone https://github.com/visiblesoft-es/claude-mods.git
claude --plugin-dir claude-mods/claudebar-mod
```

To update or uninstall, see the [repository README](../README.md#updating).

If you also have the bash claudebar set up as your `statusLine`, you will see both bars. Remove the bash one by deleting `statusLine` from `~/.claude/settings.json`, or keep it and hide lines in the mod (see Configuration).

## What it shows

The same lines and the same color thresholds as the bash claudebar. Each line is dropped when it has nothing to show.

1. **Git**: directory, branch (green when clean, yellow with changes or unpushed commits), `mod:N`, `ahead:N`, `+N -N` against HEAD, last commit subject and `[worktree: name]`.
2. **Model**: name, `⚙` effort, a context bar with `←` input tokens and `→` session output tokens, and the compact hint with the usual score (context, cache below 60% and sessions over 90 minutes; silent below 30% context).
3. **Rate limits**: 5 h and 7 days, with countdowns. Claude.ai subscriptions only.
4. **Session**: duration, cache hit rate, lines edited and cost in dollars.
5. **Tools**: the 10 most used by the main agent.
6. **Agents and skills**: subagent types launched, how many are still active, and skills used.

## What's new compared to the bash version

- **Updates itself**: countdowns, duration and counters move without waiting for a new turn. Tools are counted live, without re-reading the transcript.
- **One-click compaction**: when the hint reaches `⚡ /compact` or `⚠ COMPACT`, it turns into a button that compacts the conversation.
- **Detail pane** (the band's `Context ›`, `Git ›`, `Tools ›`, `Agents ›` and `History ›` buttons, or `/claudebar [view]`), with tabs:
  - **Context**: breakdown by category (messages, system prompt, tools, MCP, memory…), the autocompact threshold and a compact button.
  - **Tools**: every tool used by the main agent and by subagents, agents launched, skills, turns and compactions.
  - **Git**: changed files and recent commits.
  - **Agents**: one doll per agent with its status; press one to see its conversation below. 👁 marks the agent you have on screen.
  - **History**: output tokens, sessions, turns, tools and compactions per day, for the last 14 days.
- **Alerts**: when context passes 70%, 85% and 95% (they re-arm after compacting) and when a rate limit passes 80% and 95%, with the reset time.
- **History across sessions**, kept in the mod's store (last 30 days).
- **No width problems**: each line fits the available width and is truncated instead of overflowing and hiding the lines below it.
- **More places**: it draws in the terminal, the desktop app and VS Code.

`/claudebar` takes the view to open: `context`, `tools`, `git`, `agents` or `history`.

## Configuration

In `/config`, each line can be hidden (`showGit`, `showModel`, `showLimits`, `showStats`, `showTools`, `showAgents`) and alerts can be turned off (`alerts`).

## Limitations

- A mod cannot draw in the `statusLine` slot (below the prompt), so the band sits above it. In fullscreen it shares at most half the terminal with the prompt; if it does not fit, it scrolls.
- **Lines edited** are computed from the edits (Edit, Write, MultiEdit, NotebookEdit) of the main agent and of subagents, so they may not match the bash version's figure exactly.
- The cache hit rate is the main agent's last turn.
- Git is read every 10 s and after each edit or Bash command.
- It uses Claude Code's mod API, which is in early access (built on 2.1.291). On older Claude Code versions, keep using the bash claudebar.

## Development

```
hooks/register.tsx   everything that talks to the engine: events, band and pane
hooks/lib/           pure functions: formatting, git parsing, agents
types/index.d.ts     the mod's state contract
tests/               format.test.ts (formatting and git), band.test.tsx (band and pane on terminal and desktop)
```

Everything that receives `$` has to live in `register.tsx`: Claude Code's validator does not let `$` be passed to a function imported from another file.

```bash
claude plugin validate .
claude plugin test .
```
