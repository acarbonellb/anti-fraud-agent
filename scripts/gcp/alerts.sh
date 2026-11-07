#!/usr/bin/env bash
# Alert policies for the deployed pass (ADR 0018, amendment of #90).
#
# The author runs it, from this repo's checkout, after scripts/gcp/setup.sh.
# The project is the one set in the `satella` gcloud configuration and the
# email is asked for, so neither lives in the repo. Every step checks what
# already exists, so re-running it is safe; each resource it would create or
# replace asks first (CLAUDE.md §8).
#
#   scripts/gcp/alerts.sh
#
# It creates one email notification channel and four policies, each opening an
# incident on the first match:
#   - a pass logged `run.failed` (a review failed; it is queued for a retry);
#   - a pass logged `run.abandoned` (a subject nobody will review again);
#   - a pass logged `pass.budget_reached`, notified at most once a day;
#   - an execution of the job failed or timed out (a pass that never finished).
set -euo pipefail

CONFIGURATION="satella"
JOB="pass"
# Cloud Monitoring's policy and channel commands are still pre-GA in gcloud.
MONITORING=(alpha monitoring)
# Log-based policies notify at most once per period, and an incident closes
# itself after a while without matches. 5 minutes and 30 minutes are the
# floors; a day for both is what keeps a day spent at the budget to one email.
EVERY_PASS="300s"
ONCE_A_DAY="86400s"
SHORT_CLOSE="1800s"

PROJECT=$(gcloud --configuration="$CONFIGURATION" config get project 2>/dev/null || true)
[[ -n "$PROJECT" ]] || {
  echo "set a project in the '$CONFIGURATION' gcloud configuration first" >&2
  exit 1
}

g() { gcloud --configuration="$CONFIGURATION" --project="$PROJECT" --quiet "$@"; }
mon() { g "${MONITORING[@]}" "$@"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
confirm() {
  local answer
  read -r -p "  ? $* [y/N] " answer
  [[ "$answer" == [yY] ]]
}

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

# Every command below goes to the Satella project as the Satella account, never
# to whatever gcloud is active globally.
step "Account and project"
account=$(gcloud --configuration="$CONFIGURATION" config get account 2>/dev/null)
note "gcloud configuration '$CONFIGURATION' · account $account · project $PROJECT"
confirm "Set up the pass's alerts in this project?" || exit 1

step "Cloud Monitoring API"
if [[ -n "$(g services list --enabled --filter=config.name=monitoring.googleapis.com --format='value(config.name)')" ]]; then
  note "enabled"
elif confirm "Enable monitoring.googleapis.com?"; then
  g services enable monitoring.googleapis.com
else
  exit 1
fi

step "Email notification channel"
read -r -p "  ? Email that receives the alerts: " EMAIL
[[ "$EMAIL" == *@* ]] || {
  echo "not an email: $EMAIL" >&2
  exit 1
}
CHANNEL=$(mon channels list \
  --filter="type=\"email\" AND labels.email_address=\"$EMAIL\"" \
  --format='value(name)' | head -n 1)
if [[ -n "$CHANNEL" ]]; then
  note "exists"
elif confirm "Create an email channel for that address?"; then
  CHANNEL=$(mon channels create --type=email \
    --display-name="Review pass alerts" \
    --channel-labels=email_address="$EMAIL" --format='value(name)')
  note "created"
else
  exit 1
fi

# Creates the policy in the given file, or replaces the one with its name, so
# a change to this script reaches a policy that already exists.
apply_policy() {
  local name=$1 file=$2 existing
  existing=$(mon policies list --filter="displayName=\"$name\"" \
    --format='value(name)' | head -n 1)
  if [[ -z "$existing" ]]; then
    if confirm "Create the policy '$name'?"; then
      mon policies create --policy-from-file="$file" >/dev/null
      note "created"
    fi
  elif confirm "The policy '$name' exists. Replace it with this script's version?"; then
    mon policies update "$existing" --policy-from-file="$file" >/dev/null
    note "replaced"
  else
    note "kept as it is"
  fi
}

# A log-based policy on one event of the pass's JSON lines (ADR 0018 point 9).
# The labels put the run, the subject and the code in the email: ids and codes
# only, as the lines themselves (CLAUDE.md §4).
log_policy() {
  local name=$1 event=$2 period=$3 close=$4 doc=$5 file
  file="$workdir/$event.json"
  cat >"$file" <<JSON
{
  "displayName": "$name",
  "documentation": { "mimeType": "text/markdown", "content": "$doc" },
  "combiner": "OR",
  "severity": "WARNING",
  "conditions": [
    {
      "displayName": "The pass logged $event",
      "conditionMatchedLog": {
        "filter": "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\" AND jsonPayload.event=\"$event\"",
        "labelExtractors": {
          "runId": "EXTRACT(jsonPayload.runId)",
          "subjectType": "EXTRACT(jsonPayload.subject.type)",
          "subjectId": "EXTRACT(jsonPayload.subject.id)",
          "code": "EXTRACT(jsonPayload.code)"
        }
      }
    }
  ],
  "alertStrategy": {
    "notificationRateLimit": { "period": "$period" },
    "autoClose": "$close"
  },
  "notificationChannels": ["$CHANNEL"]
}
JSON
  apply_policy "$name" "$file"
}

step "Policy: a review failed"
log_policy "Pass: run.failed" "run.failed" "$EVERY_PASS" "$SHORT_CLOSE" \
  "A review failed. A transient failure is retried by the next passes; look up the run in the store by its runId."

step "Policy: a subject was abandoned"
log_policy "Pass: run.abandoned" "run.abandoned" "$EVERY_PASS" "$SHORT_CLOSE" \
  "The agent gave up on a subject after its retries: nobody will review it unless an admin does."

step "Policy: the day's budget was reached"
log_policy "Pass: pass.budget_reached" "pass.budget_reached" "$ONCE_A_DAY" "$ONCE_A_DAY" \
  "A pass stopped at the day's budget (ADR 0017). The rest of the feed waits for tomorrow; at most one email a day."

step "Policy: an execution of the job failed or timed out"
# A metric, not a log line: a timeout or an out-of-memory kill ends the
# execution as failed without the pass logging anything.
job_file="$workdir/job.json"
cat >"$job_file" <<JSON
{
  "displayName": "Pass: execution failed",
  "documentation": {
    "mimeType": "text/markdown",
    "content": "An execution of the job '$JOB' failed or timed out: that pass didn't finish. Its logs are under the execution in Cloud Run."
  },
  "combiner": "OR",
  "severity": "ERROR",
  "conditions": [
    {
      "displayName": "A failed execution of '$JOB'",
      "conditionThreshold": {
        "filter": "resource.type=\"cloud_run_job\" AND resource.labels.job_name=\"$JOB\" AND metric.type=\"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result=\"failed\"",
        "aggregations": [
          { "alignmentPeriod": "60s", "perSeriesAligner": "ALIGN_SUM" }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "1800s" },
  "notificationChannels": ["$CHANNEL"]
}
JSON
apply_policy "Pass: execution failed" "$job_file"

step "Done"
note "Alerts reach $EMAIL. To check the channel, send it a test from Cloud"
note "Monitoring's notification channels page, or wait for the next failure."
