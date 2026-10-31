#!/bin/bash
# Git guard (based on the git-guardrails-claude-code skill): blocks commands
# that overwrite the working tree or rewrite history without the user's
# confirmation. A normal `git push` stays allowed: the github-pr skill uses it.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

# End of argument: space, end of line or shell separator.
END='( |$|;|&|\|)'

DANGEROUS_PATTERNS=(
  "git checkout( [^;&|]*)? \.$END"
  "git restore( [^;&|]*)? \.$END"
  "git reset( [^;&|]*)? --hard"
  "git clean( [^;&|]*)? -[a-zA-Z]*f"
  "git branch( [^;&|]*)? -D"
  "git push( [^;&|]*)? (--force|-f$END)"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  # `git restore --staged .` only unstages: it doesn't touch the working tree.
  if [[ "$pattern" == "git restore"* ]] &&
    echo "$COMMAND" | grep -qE -- "--staged|-S( |$)" &&
    ! echo "$COMMAND" | grep -qE -- "--worktree|-W( |$)"; then
    continue
  fi
  if echo "$COMMAND" | grep -qE "$pattern"; then
    echo "BLOCKED by .claude/hooks/block-dangerous-git.sh: '$COMMAND' matches '$pattern'. It can overwrite the working tree or history. To read a file from another branch use 'git show <ref>:<path>'; otherwise ask the user to run it with '! <command>'." >&2
    exit 2
  fi
done

exit 0
