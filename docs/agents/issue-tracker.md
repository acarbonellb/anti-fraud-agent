# Issue tracker: GitHub Issues

Issues and specs for this repo live in **GitHub Issues** of `acarbonellb/anti-fraud-agent`, so
the plan, the tasks and the PRs that close them are visible in one place. Use the `gh` CLI for
all operations. The `github` MCP server in `.mcp.json` (`mcp__github__*`, needs `SATELLA_GITHUB_MCP_PAT`)
is an equivalent alternative when it's connected.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line
  bodies.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
  with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or
  `gh issue edit <parent> --add-sub-issue <child>` afterwards.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation.
  Add an edge with `gh issue create --blocked-by <n>,<n> ...` or
  `gh issue edit <child> --add-blocked-by <blocker>`. Also write a «Blocked by #n» line in the
  body so the dependency reads in plain text. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by`
  (open blockers only; 0 means startable).
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation with `gh issue comment <number> --body "..."`, then
  `gh issue close <number>`. On an already-closed issue, `gh issue close --comment` drops the
  comment and still exits 0.

Never file issues into `mattpocock/skills` (the repo these skills come from).

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr`
equivalents:

- **Read a PR**: `gh pr view <number>`, then `gh pr view <number> --comments`, and
  `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`,
  `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with
`gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create an issue in this repo. One issue = one vertical slice that a single PR can close.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Specs and implementation tickets (`/to-spec`, `/to-tickets`)

| Artifact              | GitHub                      | Hierarchy                                                      |
| --------------------- | --------------------------- | -------------------------------------------------------------- |
| Spec                  | Issue with the `spec` label | Top level                                                      |
| Implementation ticket | Issue                       | Sub-issue of its spec; blockers as native dependencies (above) |

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

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog
  body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a
  sub-issue of a parent**). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`).
  Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: list the map's open sub-issues, drop any with an open blocker (see **Count
  open blockers**) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a
  context pointer (gist + link) to the map's Decisions-so-far.
