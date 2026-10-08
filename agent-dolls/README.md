# agent-dolls

A Claude Code mod that shows, in a side pane, one little robot for each agent in the session: the main agent and every subagent it launched. Press a robot and its conversation appears below, in the same pane.

```
     ✦
  ▗▄▄█▄▄▖   [ Main ]
  ▐ ● ● ▌   Main agent
  ▝▀▙▄▟▀▘   ▶ working

       ✦
    ▗▄▄█▄▄▖   [ Explore ]
    ▐ ● ● ▌   find endpoints
    ▝▀▙▄▟▀▘   working · 👁 on screen

       ╻
    ▗▄▄█▄▄▖   [ general-purpose ]
  ▝▘▐ ^ ^ ▌▝▘ migrate tests
    ▝▀▙▄▟▀▘   finished
```

Press a robot and the robots shrink to one line each, with its conversation below:

```
▐●●▌ [ Main ] working
  ▐●●▌ [ Explore ] ▶ working · 👁 on screen
  ▐^^▌ [ general-purpose ] finished
────────────────────────────────────────
▐●●▌ find endpoints              [ Close ]
» Find the endpoints
› Grep MapGet
Found 14 endpoints…
```

## Installation

Requires Claude Code with mod support (tested on the latest version).

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
- Each robot shows the agent's type, its description and its status, and its face follows that status: eyes open `● ●` while working (with a blinking antenna), `– –` idle, `^ ^` with raised arms when finished, `× ×` when failed. Its color says the agent's type: Claude orange for the main agent, cyan for Explore, magenta for Plan, yellow for general-purpose. Subagents are indented under the agent that launched them.
- Press a robot to see its conversation (messages and tools used) below; it refreshes every 1.5 s. Press it again, or **Close** or **Main**, to hide it.
- **👁 on screen** marks the agent whose conversation you have open in Claude Code's own view (the one you switch from the task bar below the prompt).

## Limitations

- A mod cannot switch Claude Code's main view to a subagent's; it can only read which one is on screen. That is why the conversation is shown inside the pane.
- Claude Code shows one mod pane at a time (the others become tabs), so the robots and the conversation share the same pane.
- Claude Code drops finished subagents from its list shortly after they end, and their robots go with them.
- If a subagent finished without saving its conversation, the pane shows the reason instead of the messages.
- The pane docks beside the conversation in fullscreen mode; otherwise it appears above the prompt.

## Development

```
hooks/register.tsx        the pane's logic and drawing
hooks/lib/robot.ts        the robots, as pure functions
types/index.d.ts          the mod's state ($.state) contract
tests/agent-dolls.test.tsx
tests/robot.test.ts
```

```bash
claude plugin validate .
claude plugin test .
```

When Claude Code loads the mod it writes the API types into `.claude-plugin/types/` (ignored by the repository's `.gitignore`); with them, `tsc -p .` type-checks the mod.

Built on Claude Code's mod API, which is in early access and may change between releases.
