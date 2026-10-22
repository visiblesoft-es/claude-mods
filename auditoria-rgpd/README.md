# auditoria-rgpd

A Claude Code skill, written in Spanish, that runs a technical GDPR audit of an application's code under Spanish law (RGPD, LOPDGDD, Estatuto de los Trabajadores, LSSI). It is tuned for .NET / EF Core, Angular and Flutter, but the method works on any stack.

It does not change code. It reads the repository and writes a findings report to `doc/AUDITORIA-RGPD-<date>.md`:

- **Scope** and assumptions, so the report is not read as exhaustive.
- **Processing map**: activity, data, subjects, purpose, legal basis, recipients, country and retention.
- **Findings**, each with severity, confidence, type, articles, verbatim evidence (`file:line`), recommended fix and what would close it.
- **Docs vs code check**: claims from your DPIA and privacy docs ("all PII is encrypted", "no employee data leaves the EU") are verified against the code; contradictions become findings.
- **Next actions** ranked by impact, and an offer to draft patches for the findings you pick.

It never reproduces secret values it finds, and it never says "compliant" or "non-compliant": compliance is a legal call.

## Installation

From a Claude Code session in the terminal:

```
/plugin install auditoria-rgpd --marketplace visiblesoft-es/claude-mods
```

Or from your shell:

```bash
claude plugin marketplace add visiblesoft-es/claude-mods
claude plugin install auditoria-rgpd@claude-mods
```

To update or uninstall, see the [repository README](../README.md#updating).

## Usage

Inside the repository you want to audit:

```
/auditoria-rgpd:auditoria-rgpd
```

Or just ask, for example: *"Haz una auditoría RGPD de este repositorio"*.

## Credits

The audit method (phases, finding schema, severity and confidence axes, evidence-gap discipline) is adapted from [`gdpr-audit`](https://github.com/mastepanoski/claude-skills) by mastepanoski, MIT License. This version adds the Spanish legal context, stack-specific detection guides and the docs-vs-code phase.

## Disclaimer

The output is a technical audit of the materials reviewed. It is not legal advice.
