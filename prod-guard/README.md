# prod-guard

A Claude Code mod that keeps production in view. A red band shows while a session touches production, and any command that may change production asks you first, in auto mode and in subagents too.

```
⚠ PRODUCTION 10.0.0.1 · 4 commands · 1 possible write [ Unlock 15 min ] [ Clear ]
```

## What it does

- **Recognizes production** from your own list: hosts (IPs and domains anywhere in a command, SSH aliases only as the target of `ssh`, `scp`, `rsync` or `sftp`), Docker contexts (named in the command, or the one in use, read from `docker context show`) and regular expressions for scripts.
- **Fails closed.** A production command runs without asking only if every part of it is on a short read-only list (`ls`, `cat`, `docker ps`, `docker logs`, `systemctl status`, a plain `curl` and so on). Everything else asks: redirections, substitutions, loops, `scp`, `docker exec` and whatever it does not know.
- **Unlocks on request.** During a deployment, press `Unlock 15 min` or run `/prod-guard unlock [minutes]`. Unlocking lasts for that session only; `Lock` ends it early. An unlocked command still goes through your normal permission mode.

## Commands

- `/prod-guard` shows what is guarded.
- `/prod-guard test <command>` says what would happen to a command, without running it.
- `/prod-guard unlock [minutes]` and `/prod-guard lock`.

## Options

In `/config`: `hosts`, `dockerContexts` and `patterns` (comma-separated) and `bandMinutes`. All are empty by default, so nothing is guarded until you fill them in.

## Limits

It is a guardrail against mistakes, not a security boundary. It reads the text of the command, so it cannot see what a script does inside: add scripts that reach production, such as `deploy\.sh`, to `patterns`. It covers the `Bash` and `Monitor` tools only.
