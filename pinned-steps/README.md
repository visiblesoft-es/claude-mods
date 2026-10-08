# pinned-steps

A Claude Code mod that pins the step-by-step procedures Claude gives you above the prompt. Ask a question or fix a problem halfway through and the steps stay where you can see them, with the one you are on highlighted. A procedure that interrupts another goes on top of it; when you finish it, the first one comes back.

```
────────────────────────────────────────────────────────────────────────────────
▶ Deploy to staging ▓▓▓░░░░░ 3/7
 ☐ Run `dotnet ef database update` on staging  [ ✓ Done ] [ Continue ] [ Copy ] [ Steps › ]
  ↳ paused: Configure the server · step 2/5
```

## Installation

Requires Claude Code with mod support (tested on 2.1.294).

From a Claude Code session in the terminal:

```
/plugin install pinned-steps --marketplace visiblesoft-es/claude-mods
```

Answer `y` to add the marketplace and pick a scope (the user scope is the first one). The mod is active as soon as it is installed, with no restart.

Or from your shell:

```bash
claude plugin marketplace add visiblesoft-es/claude-mods
claude plugin install pinned-steps@claude-mods
```

To update or uninstall, see the [repository README](../README.md#updating).

## How it works

1. **Claude writes the procedure as a `steps` block.** The mod adds a short instruction to Claude's system prompt: when it gives you a procedure to carry out yourself, it writes the steps in a fenced block like this one, not as an ordinary list:

   ````
   ```steps
   # Deploy to staging
   1. Pull main and build
   2. Run `dotnet ef database update` on staging
      It takes about a minute.
   3. Restart the service
   ```
   ````

   An optional `# Title` comes first, then one numbered line per step. Lines that are not numbered are details of the step above them.
2. **The mod pins it** as soon as the answer arrives, and shows the current step in the band above the prompt.
3. **Claude knows where you are.** Every prompt you send carries a short note Claude reads and you do not see: which procedure you are following, which step you are on and which ones are paused. So "let's continue" is all you need to say after a detour.

Claude only uses the block for procedures you perform yourself, not for its own plan or for ordinary lists. If it wrote a numbered list without the block, `/steps pin` pins it anyway.

## Using it

- **✓ Done** marks the current step done (and any before it) and moves on.
- **Continue** marks it done and sends Claude "I've done step 3 of …, let's continue with step 4", so it walks you through the next one.
- **Copy** copies the step's command (its first `code` span) to the clipboard.
- **Steps ›** or `/steps` opens the pane with every procedure and its steps. On the current step there are also:
  - **✗ Failed**: marks the step and starts a prompt, `Step 3 of "Deploy to staging" (…) failed: `, for you to finish with the error.
  - **Skip** and **↶ Back** (undo the last step marked).
  - **Resume** brings a paused procedure back to the top, **Show** lists its steps, and **Drop** removes a procedure. **Clear all** empties the stack.

### The stack

When Claude gives you a new procedure while another is half done, the new one goes **on top** and the other is paused under it (`↳ paused: …`). When you finish the new one, it leaves the stack and the paused one comes back, at the step where you left it. If Claude writes a block with the **same title** as a pinned procedure, it revises that procedure in place and keeps the steps already done.

The stack is kept per project directory, so it survives `/compact`, restarts and new sessions in the same directory.

### Commands

| Command | What it does |
| --- | --- |
| `/steps` | Open the pane |
| `/steps pin` | Pin the steps of Claude's last answer: its `steps` blocks, or else its last numbered list |
| `/steps done` | Mark the current step done |
| `/steps next` | Mark it done and ask Claude to continue |
| `/steps clear` | Remove every pinned procedure |

## Configuration

In `/config`:

- `autoPin` (on by default): turn it off and Claude is no longer asked to write `steps` blocks or told where you are; only `/steps pin` pins.
- `showSeparator`: the dim rule between the conversation and the band.

## With claudebar-mod

Both mods draw in the band above the prompt and are shown together, each under its own separator. claudebar-mod 0.2.2 or later is needed for that; earlier versions draw over the steps.

## Limitations

- Pinning depends on Claude writing the `steps` block; when it does not, use `/steps pin`.
- Only the main conversation's answers are pinned, not the subagents'.
- The stack holds at most six procedures; the oldest is dropped past that.
- Claude Code shows one mod pane at a time; the others become tabs.

## Development

```
hooks/register.tsx     everything that talks to the engine: hooks, band, pane and command
hooks/lib/steps.ts     pure functions: parsing steps and the stack
types/index.d.ts       the mod's state contract
tests/                 steps.test.ts (parsing and the stack), pinned-steps.test.tsx (band, pane and flow)
```

```bash
claude plugin validate .
claude plugin test .
```
