# compact-handoff

A Claude Code mod for long sessions. It warns when the context passes a size you choose, and it makes every compaction a working handoff, so the conversation continues without you explaining everything again.

```
⚠ Context 342k past the 300k handoff threshold [ Handoff & compact ] [ Snooze 100k ]
```

## What it does

- **Warns in tokens, not percent.** On a 1M window, a percentage alert arrives far too late. The band appears once a turn ends past the threshold (300k by default, or 70% of the window if that is smaller).
- **Makes every compaction a handoff.** The band's button, `/handoff`, `/compact`, other mods' buttons and automatic compaction all tell the summarizer to keep the goal, the plan and current step, decisions and corrections, pending manual checks, running work and the next action.
- **Adds measured facts.** The summary also gets the branch, last commit, uncommitted files, unpushed commits and the plan or status files used in the session (`docs/superpowers/plans|specs/*.md`, `STATUS.md`, `DECISIONS.md`, `SPEC.md`, `ARCHITECTURE.md`, `*PLAN*.md`).

Subagents' own compactions are left alone. The mod writes no files and does not change your `autoCompactWindow`.

## Commands

`/handoff [what else to keep]` compacts now, between turns.

## Options

In `/config`: `threshold` and `snoozeStep`, both in tokens.
