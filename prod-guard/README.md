# prod-guard

A Claude Code mod that keeps production in view. A red band shows while a session touches production, and any command that may change production asks you first, in auto mode and in subagents too.

```
⚠ PRODUCTION 10.0.0.1 · 4 commands · 1 possible write [ Unlock 15 min ] [ Clear ]
```

## What it does

- **Recognizes production** from your own list: hosts (IPs and domains anywhere in a command, SSH aliases only as the target of `ssh`, `scp`, `rsync` or `sftp`), Docker contexts (every one named in the command, or the one in use, read from `docker context show`) and regular expressions for scripts.
- **Asks unless it is clearly a read.** A production command runs without asking only if every part of it matches a short list of read-only commands and arguments (`ls`, `cat`, `docker ps`, `docker logs`, `systemctl status`, a `curl` with no options that send data, and so on). Everything else asks: redirections, substitutions, loops, `scp`, `docker exec`, `ssh` with no remote command, tunnels and whatever it does not know. It only tightens: what your permission rules refuse stays refused.
- **Unlocks on request.** During a deployment, press `Unlock 15 min` or run `/prod-guard unlock [minutes]`. Unlocking lasts for that session only; `Lock` ends it early. An unlocked command still goes through your normal permission mode.

## Commands

- `/prod-guard` shows what is guarded.
- `/prod-guard test <command>` says what would happen to a command, without running it.
- `/prod-guard unlock [minutes]` and `/prod-guard lock`.

## Options

In `/config`: `hosts` and `dockerContexts` (comma-separated), `patterns` (space-separated regular expressions) and `bandMinutes`. The lists are empty by default, so nothing is guarded until you fill them in. `/prod-guard` lists any pattern that is not a valid regular expression.

## Limits

It is a guardrail against mistakes, not a security boundary, and reading a shell command can never be exact: an unusual spelling may still pass as a read. It reads the text of the command, so it cannot see what a script does inside: add scripts that reach production, such as `deploy\.sh`, to `patterns`. It covers the `Bash` and `Monitor` tools only. Where a program hosts the session, that program answers the question, not necessarily you.
