---
name: github-pr
description: Opens GitHub PRs with a standard title (type(#issue): short imperative title) and body (Where / Summary / Evidence / Merge risk), and manages existing PRs. Use when the user says "open a PR", "haz PR", "crea la PR", asks to publish a change as a pull request, to push changes to an existing PR, to merge it, or says it was merged.
---

# GitHub PRs

Standard flow for pull requests in this repo. Don't improvise the format.

## Rules

- PRs, titles and commits in **English**.
- **Branch guard first:** if `HEAD` is `main`, abort: no commit, no push, no PR. Exception: the
  user names the issue for the change; then create the branch from `HEAD`
  (`git switch -c <type>/<n>-<slug>`, which carries uncommitted changes) and continue.
- **Branch name:** `<type>/<issue-number>-<slug>`, English, lowercase, hyphens. Without an issue,
  `<type>/<slug>`. A `worktree-*` branch gets renamed before the first push
  (`git branch -m …`); the `pre-push` hook rejects anything else.
- **One PR closes one issue.** Read the issue with the GitHub MCP before writing: the slug, the
  title and «Where» come from it, not from memory.
- **Already merged?** Before committing on an existing branch, check with the MCP that it has no
  merged PR (`list_pull_requests`, `state: "closed"`, `head: "<owner>:<branch>"`, `merged_at` not
  null). After a squash, git doesn't show it. If merged: new branch from `origin/main` and
  cherry-pick the new commits.
- Since the user asked for a PR, **commit and push automatically**.
- **Merge convention:** squash and merge into `main`. The skill doesn't merge unless asked.
- GitHub operations go through the **GitHub MCP**. `gh` only for read-only CI debugging
  (`gh run list`, `gh run view --log-failed`) and for uploading attachments
  (`gh pr comment --attach`), which the MCP can't do.

## 1. Title

```
<type>(#<issue>): <imperative verb + what, short>
```

`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`, `revert`. Lowercase, no final
period, **≤ 100 characters** in total (it is also the squash commit, and commitlint rejects longer
headers). Without an issue, drop the scope: `chore: bump vitest`.

## 2. Body

```
### Where

Closes #<n>

<the issue's intent in one paragraph, not technical>

### Summary

<the smallest view that makes the change clear>

### Evidence

- **Before:** <failing test, output or eval metric>
  **After:** <passing test, output or eval metric>

### Merge risk

**Door:** <one-way | two-way>

<optional: why>

**Scope:** <one or two words>
```

- **Summary:** pick the smallest view: pseudocode for logic, a call tree for a runtime flow, a
  Mermaid diagram for pieces talking to each other (agent ↔ provider ↔ Satella), a shallow file
  tree for a refactor, a `diff` block over an existing shape. One or two visuals, rarely more.
- **Evidence:** the test that failed and now passes, command output, or **eval metrics before and
  after** (accuracy, approved-fraud rate, cost) when the change touches prompts, policy or tools.
  Docs-only: say so in one line.
- **A PR that moves eval metrics** (prompt, model, tools, checks, policy): Evidence shows the
  before and after `evals/history.jsonl` entries (id, note and the key gated metrics) and links
  its `docs/experiments.md` section (ADR 0014).
- **Door:** two-way if reverting leaves everything as it was; one-way if not (data migrations,
  anything sent to Satella, deleting recordings or eval history).

Body template adapted from Matt Pocock's `pr` skill (`mattpocock/skills`), itself based on Dex
Horthy's `show-me`; the plugin's `pr` skill is disabled here so it doesn't compete.

## 3. Open the PR

1. Branch guard (Rules).
2. Commit with Conventional Commits and the issue as scope: `feat(#12): add claude adapter`.
   Hooks run lint-staged, gitleaks and commitlint: check `git log --oneline -1` in a separate call
   before pushing.
3. `git push -u origin <branch>`.
4. `create_pull_request` (MCP): `owner`/`repo` from `git remote -v`, base `main`.
5. Confirm with `pull_request_read` and reply with the URL.

**Update an existing PR:** commit, push to its branch, and **update the body** with
`update_pull_request` so Summary, Evidence and Merge risk match the new diff.

## 4. Merge (only when asked)

1. Check runs all `success` or `skipped` (`pull_request_read`, `method: "get_check_runs"`).
   Otherwise report and stop.
2. `merge_pull_request` with `merge_method: "squash"`, `commit_title: "<PR title> (#<PR number>)"`
   and the full 40-char head SHA.
3. Check the issue closed through `Closes #n`.
4. Update local `main`: `git switch main && git pull --ff-only origin main && git fetch --prune`.
   Deleting the squashed branch needs `git branch -D`, which the hook blocks: hand the command to
   the user.
