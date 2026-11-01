# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/agent-design-brief.md`**: the specification (§13 overrides §3). For the Satella contract
  it is design history: the shipped agent API v1, modelled in `src/satella-client/schemas.ts`,
  wins where they differ (ADR 0011).
- **`docs/adr/`**: ADRs that touch the area you're about to work in.

If a file doesn't exist yet, proceed silently; `/domain-modeling` creates them when terms or
decisions get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (issue title, test name, log field, prompt), use the term
as defined in `GLOSSARY.md`. A concept missing from it is either invented language (reconsider)
or a real gap (note it for `/domain-modeling`).

## Flag ADR and brief conflicts

If your output contradicts an ADR or the brief, surface it explicitly rather than silently
overriding:

> _Contradicts ADR-0003 (provider-neutral loop), but worth reopening because…_
