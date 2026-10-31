---
name: adr
description: ADRs of anti-fraud-agent. Load before writing a new ADR or an amendment in docs/adr/, before deciding whether a decision needs one, or when implementing one of the design brief's decisions D1–D10.
---

# Writing an ADR or an amendment

`/mattpocock-skills:domain-modeling` helps think the decision through; this skill fixes **this
repo's format and the places a decision touches**. An ADR that isn't in the index doesn't exist.

ADRs here also serve as interview material: each one must let a reader argue the decision,
including what was rejected and why.

## 0. New ADR, amendment or nothing?

- **New ADR** when the decision sets or changes a rule code and docs must obey: an integration
  contract, data ownership, autonomy policy, provider strategy, security boundary, deployment
  shape, cost controls. Also when it **replaces** an earlier ADR (the old one becomes superseded).
- **Amendment** when it refines, extends or corrects a decision without reversing it.
- **Nothing** when it's an implementation detail that fits in the issue and a code comment. Test:
  will someone in six months need to know _why_, not just _what_? If yes, ADR.

The brief's decisions **D1–D10** (`docs/agent-design-brief.md` §12) become ADRs 0001–0010 when
each is implemented; carry over their «rejected» alternatives.

## 1. Template

File `docs/adr/NNNN-<short-slug>.md`, next free number:

```markdown
# ADR NNNN — Title that states the decision, not the topic

- **Date:** YYYY-MM-DD
- **Status:** accepted | proposed | superseded by ADR NNNN (YYYY-MM-DD)
- **Related:** ADR XXXX (how), brief §N, issue #N.

## Context

What was happening, what broke or was missing, with facts. No decision yet.

## Decision

1. **One bold sentence per decision**, with the detail below: what changes, what doesn't, edge cases.

## Alternatives rejected

- **Option**: why not.

## Consequences

What it implies for code, data, docs and operations; what is left open.
```

Status line accumulates amendments: `· amendment YYYY-MM-DD (#N)`. English, short prose, facts
with numbers and dates, code names in backticks.

## 2. Amendment

At the end of the ADR:

```markdown
## Amendment (YYYY-MM-DD, #N): what changes

What it refines and why; if it contradicts a point, say so ("replaces point 3").
```

## 3. Places it touches (none optional)

| Place                     | What                                               |
| ------------------------- | -------------------------------------------------- |
| `docs/adr/NNNN-….md`      | The ADR or amendment                               |
| `docs/adr/README.md`      | A row: number, decision in one line, status        |
| `GLOSSARY.md`             | Every new or redefined term                        |
| The issue                 | Links the ADR; the ADR cites the issue             |
| Docs the decision changes | `CLAUDE.md`, `CODING_STANDARDS.md`: in the same PR |

## Done when

Next free number, full header, «Alternatives rejected» filled in, listed in `docs/adr/README.md`,
glossary updated, issue and ADR linked both ways.
