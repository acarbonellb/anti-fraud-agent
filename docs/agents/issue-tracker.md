# Issue tracker: GitHub Issues

Issues and specs for this repo live in **GitHub Issues** of this repository, so the plan, the
tasks and the PRs that close them are visible in one place. Use the GitHub MCP
(`mcp__github__*`) to read, search, create and comment.

## When a skill says "publish to the issue tracker"

Create an issue in this repo. One issue = one vertical slice that a single PR can close.

## Specs and implementation tickets (`/to-spec`, `/to-tickets`)

| Artifact              | GitHub                      | Hierarchy                                                                           |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| Spec                  | Issue with the `spec` label | Top level                                                                           |
| Implementation ticket | Issue                       | Sub-issue of its spec (`sub_issue_write`); blockers named in a «Blocked by #n» line |

- **Vertical slices, never by layer.** Each ticket delivers observable behaviour end to end; no
  tests-only or "types-only" tickets.
- **A `ready-for-agent` ticket carries «Seams to test»** after its acceptance criteria: one bullet
  per public interface the tests go through, with the cases it covers. That pre-agrees the seams
  `/tdd` asks for.
- Create blockers first so each «Blocked by» references a real number.

## Branches and PRs

- Branch: `<type>/<issue-number>-<slug>` (e.g. `feat/12-provider-adapters`).
- The PR body says `Closes #<n>` so merging closes the issue (`github-pr` skill).

## When to act

- **Starting work on an issue**: assign it to the user and add the `in-progress` label before
  touching code.
- **After merging**: GitHub closes the issue through `Closes #n`; check it did.
