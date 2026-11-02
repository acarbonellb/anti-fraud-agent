# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the
label strings used in this repo's GitHub Issues.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

**Open decisions make a ticket `ready-for-human`.** A ticket that carries a decision still to take
("decide here whether…") is `ready-for-human`, even when a skill defaults to `ready-for-agent`.
Take the decision with the user first and write it into the ticket.

**Every domain term in the acceptance criteria resolves before `ready-for-agent`.** Check each
term against `GLOSSARY.md` and the design brief. A term missing from both, or meant differently,
is an open decision until the user picks the meaning and it lands in `GLOSSARY.md`.

**Anything about Satella resolves against the shipped contract, then the brief.** First
`src/satella-client/schemas.ts` and Satella's agent API surface (ADR 0011), then the brief. A
criterion that needs a Satella behaviour neither states (brief §10 lists the known doubts) is
`ready-for-human`: the answer comes from the user, never from guessing.

**A ticket that can move the eval metrics states its hypothesis before `ready-for-agent`.** A
ticket that touches the prompt, a model, the tools, the checks or the policy says which metrics it
expects to move, which way and why (e.g. «the approved-fraud rate drops below 20 % with accuracy
no lower»). The hypothesis goes into its `docs/experiments.md` section, measured against the
history (ADR 0014).

**A `ready-for-agent` ticket answers a skill's confirmation gates.** When a skill asks to confirm
something before acting (e.g. `/tdd`'s seams), the AFK agent takes the answer from the ticket's
«Seams to test» or acceptance criteria and cites the lines it relied on. A gate the ticket doesn't
settle is an open decision: ask.
