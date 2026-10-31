---
name: env-var
description: Environment variables of anti-fraud-agent. Load before adding, renaming, rotating or removing an environment variable or secret, or when something fails because a variable is missing or differs between local, CI and GCP.
---

# Environment variables

The repo is public-bound: **names live in the repo, values never do.**

## Rules

- **`.env.example` is the single list of names**, grouped by area, each with a comment: what it
  is, whether it's required, how to get or generate it. No real values, not even test ones.
- **Read once, validate at the edge:** one config module parses `process.env` with Zod at startup
  and fails with a clear message. No `process.env.X` scattered through the code.
- **Name:** `SCREAMING_SNAKE`, with the service as prefix (`ANTHROPIC_`, `OPENAI_`, `XAI_`,
  `SATELLA_`, `AGENT_`).
- **Secrets never pass through the agent's output**: not in chat, not in a command line, not in a
  log. To check a value exists: `[ -n "$VAR" ]`. To find where it's set: `grep -l`, never
  `grep -n` (prints the value).
- **One value per environment.** The staging credentials never work in another environment, and
  LLM keys are demo-only keys with a spend cap at the provider (brief §6.3).
- **Mutations outside the repo** (GitHub Actions secrets, GCP Secret Manager) are run by the user:
  prepare the exact command without the value (`printf '%s' "$VAL" | …`) and ask them to run it.

## Places

| #   | Place                              | What                                                          | Who                    |
| --- | ---------------------------------- | ------------------------------------------------------------- | ---------------------- |
| 1   | `.env.example`                     | Name, comment, example or empty value                         | Agent, in the PR       |
| 2   | Config module                      | Zod schema entry; required or optional with default           | Agent, in the PR       |
| 3   | Local `.env` (gitignored)          | Development value                                             | User                   |
| 4   | Test setup                         | A fake value if the config requires it, so CI and tests start | Agent, in the PR       |
| 5   | GitHub Actions secrets             | Only what workflows read                                      | User (`gh secret set`) |
| 6   | GCP Secret Manager / Cloud Run env | Deployed values (from step 6 of the brief §9)                 | User                   |

## Done when

Every place that applies is covered, `.env.example` and the config schema list the same names,
and tests start without real secrets.
