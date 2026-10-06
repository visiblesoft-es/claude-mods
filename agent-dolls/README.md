# agent-dolls

A Claude Code mod that shows, in a side pane, one doll for each agent in the session: the main agent and every subagent it launched. Press a doll and its conversation appears below, in the same pane.

```
┌─ Agents ─────────────────────────────────┐
│  o  [ 🧑 Main ]      idle                │
│  o  [ 🔍 Explore ]   ▶ working           │
│ \o/ [ 🛠 general ]   finished            │
│ ──────────────────────────────────────── │
│ 🔍 find endpoints               [Close]  │
│ » Find the endpoints                     │
│ › Grep MapGet                            │
│ Found 14 endpoints…                      │
└──────────────────────────────────────────┘
```

## Installation

Requires Claude Code with mod support (tested on 2.1.291).

From a Claude Code session in the terminal:

```
/plugin install agent-dolls --marketplace visiblesoft-es/claude-mods
```

Answer `y` to add the marketplace and pick a scope (the user scope is the first one). The mod is active as soon as it is installed, with no restart.

Or from your shell:

```bash
claude plugin marketplace add visiblesoft-es/claude-mods
claude plugin install agent-dolls@claude-mods
```

To try it from a local clone, without installing:

```bash
git clone https://github.com/visiblesoft-es/claude-mods.git
claude --plugin-dir claude-mods/agent-dolls
```

To update or uninstall, see the [repository README](../README.md#updating).

## Usage

- `/dolls` opens the pane. (It is not `/agents`, which is Claude Code's own command for managing subagents.)
- Each doll shows the agent's type, its description and its status: working, waiting, idle, finished (`\o/`) or failed (`x`). Subagents are indented under the agent that launched them.
- Press a doll to see its conversation (messages and tools used) below; it refreshes every 1.5 s. Press it again, or **Close** or **Main**, to hide it.
- **👁 on screen** marks the agent whose conversation you have open in Claude Code's own view (the one you switch from the task bar below the prompt).

## Limitations

- A mod cannot switch Claude Code's main view to a subagent's; it can only read which one is on screen. That is why the conversation is shown inside the pane.
- Claude Code shows one mod pane at a time (the others become tabs), so the dolls and the conversation share the same pane.
- Claude Code drops finished subagents from its list shortly after they end, and their dolls go with them.
- If a subagent finished without saving its conversation, the pane shows the reason instead of the messages.
- The pane docks beside the conversation in fullscreen mode; otherwise it appears above the prompt.

## Development

```
hooks/register.tsx        the pane's logic and drawing
types/index.d.ts          the mod's state ($.state) contract
tests/agent-dolls.test.tsx
```

```bash
claude plugin validate .
claude plugin test .
```

When Claude Code loads the mod it writes the API types into `.claude-plugin/types/` (ignored by the repository's `.gitignore`); with them, `tsc -p .` type-checks the mod.

Built on the Claude Code 2.1.291 mod API, which is in early access and may change between releases.
