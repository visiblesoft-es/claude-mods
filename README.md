# claude-mods

[Claude Code](https://claude.ai/code) mods by VisibleSoft. A mod is a plugin of *function hooks*: code that runs inside Claude Code and can draw interactive panes and bands, react to tool calls and prompts, and add commands.

This repository is a plugin marketplace: `.claude-plugin/marketplace.json` lists every mod.

| Mod | What it does |
| --- | --- |
| [claudebar-mod](claudebar-mod/) | claudebar as a mod: an interactive band with git, model, effort, context, rate limits, cache, tools and agents, plus detail panes, alerts and history |
| [agent-dolls](agent-dolls/) | Side pane with one doll per agent (main and subagents); press one to see its conversation |

## Requirements

- Claude Code with mod support. The mods are tested on **Claude Code 2.1.291**. The mod API is in early access and may change between releases, so an older or newer version might not load them.
- Nothing else: no `jq`, no Node, no setup step.

Check your version with `claude --version`.

## Installation

### From a Claude Code session

At the prompt of a terminal session:

```
/plugin install claudebar-mod --marketplace visiblesoft-es/claude-mods
```

1. Answer `y` to add the marketplace (first time only).
2. Pick a scope: the user scope (the first one) enables the mod in all your sessions.

The mod is active right away in that session, with no restart. Replace `claudebar-mod` with `agent-dolls` to install the other one.

### From your shell

```bash
claude plugin marketplace add visiblesoft-es/claude-mods
claude plugin install claudebar-mod@claude-mods
claude plugin install agent-dolls@claude-mods
```

### From a local clone, without installing

Handy for trying out changes:

```bash
git clone https://github.com/visiblesoft-es/claude-mods.git
claude --plugin-dir claude-mods/claudebar-mod
```

Repeat `--plugin-dir` to load several mods at once.

## Updating

```bash
claude plugin marketplace update claude-mods
claude plugin update claudebar-mod@claude-mods
```

Then run `/reload-plugins` in any open session to load the new version.

## Uninstalling

```bash
claude plugin uninstall claudebar-mod@claude-mods
```

To remove the marketplace too: `claude plugin marketplace remove claude-mods`.

## Configuration

Mods with options (for example, which lines claudebar-mod shows) add them to `/config`. You can also inspect them from your shell with `claude plugin configure <mod>`.

## Adding a mod

1. Create a `<mod>/` folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` and `hooks/register.tsx` (plus `types/index.d.ts` if it uses `$.state`).
2. Add its entry to `.claude-plugin/marketplace.json`: `{ "name": "<mod>", "source": "./<mod>", "description": "..." }`.
3. Check that everything validates and its tests pass:

   ```bash
   claude plugin validate .
   claude plugin validate ./<mod>
   claude plugin test ./<mod>
   ```

## License

[MIT](LICENSE)
