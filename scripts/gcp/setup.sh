#!/usr/bin/env bash
# One-time GCP setup for the deployed pass (ADR 0018, issue #46).
#
# The author runs it, from this repo's checkout, after the Satella account,
# project and billing exist. It reads the project from the environment (direnv
# loads it from `.env.gcloud`, which git ignores), so no id lives in the repo.
# Every step checks what already exists, so re-running it is safe. Each
# resource it would create asks first (CLAUDE.md §8).
#
#   SATELLA_GCP_PROJECT=<id> scripts/gcp/setup.sh
#
# It never writes a secret's value: the two secrets are created empty, and the
# closing notes print the commands that add their values. It also never resumes
# the Scheduler trigger: that is #9's step.
set -euo pipefail

PROJECT="${SATELLA_GCP_PROJECT:?set SATELLA_GCP_PROJECT (direnv loads it from .env.gcloud)}"
REGION="europe-west1"
REPO_SLUG="acarbonellb/anti-fraud-agent"
JOB="pass"
REGISTRY="agent"
POOL="github"
PROVIDER="anti-fraud-agent"
SECRETS=(AGENT_LLM_API_KEY TAVILY_API_KEY)
# Google's sample job image, until the first deploy replaces it: a job can't
# exist without an image, and the deploy account may update this job only.
PLACEHOLDER_IMAGE="us-docker.pkg.dev/cloudrun/container/job:latest"

g() { gcloud --configuration=satella --project="$PROJECT" --quiet "$@"; }
sa() { printf '%s@%s.iam.gserviceaccount.com' "$1" "$PROJECT"; }
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
confirm() {
  local answer
  read -r -p "  ? $* [y/N] " answer
  [[ "$answer" == [yY] ]]
}

# Every command below goes to the Satella project as the Satella account, never
# to whatever gcloud is active globally.
step "Account and project"
account=$(gcloud --configuration=satella config get account 2>/dev/null)
note "gcloud configuration 'satella' · account $account · project $PROJECT"
confirm "Set up the pass in this project?" || exit 1
PROJECT_NUMBER=$(g projects describe "$PROJECT" --format='value(projectNumber)')

step "Firestore (default) database in $REGION"
if g firestore databases describe --database='(default)' >/dev/null 2>&1; then
  note "exists"
elif confirm "Create the (default) Firestore database in $REGION? Its location can't change later."; then
  g firestore databases create --database='(default)' --location="$REGION"
fi

step "Artifact Registry repository '$REGISTRY'"
if g artifacts repositories describe "$REGISTRY" --location="$REGION" >/dev/null 2>&1; then
  note "exists"
elif confirm "Create the Docker repository '$REGISTRY' in $REGION?"; then
  g artifacts repositories create "$REGISTRY" --location="$REGION" \
    --repository-format=docker --description="Images of the review pass"
fi
# The last 3 images stay; older ones go, so storage stays near the free tier.
policy=$(mktemp)
trap 'rm -f "$policy"' EXIT
cat >"$policy" <<'JSON'
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 3 } },
  { "name": "delete-older", "action": { "type": "Delete" }, "condition": { "tagState": "any" } }
]
JSON
g artifacts repositories set-cleanup-policies "$REGISTRY" --location="$REGION" \
  --policy="$policy" >/dev/null
note "cleanup policy: keep the last 3 images"

step "Secrets (containers only, no values)"
for secret in "${SECRETS[@]}"; do
  if g secrets describe "$secret" >/dev/null 2>&1; then
    note "$secret exists"
  elif confirm "Create the empty secret $secret?"; then
    g secrets create "$secret" --replication-policy=automatic
  fi
done

step "Service accounts"
for name in pass-job pass-scheduler deployer; do
  if g iam service-accounts describe "$(sa "$name")" >/dev/null 2>&1; then
    note "$name exists"
  elif confirm "Create the service account $name?"; then
    g iam service-accounts create "$name" --display-name="Review pass: $name"
  fi
done

step "The job's account: Firestore and its two secrets"
g projects add-iam-policy-binding "$PROJECT" --condition=None \
  --member="serviceAccount:$(sa pass-job)" --role=roles/datastore.user >/dev/null
for secret in "${SECRETS[@]}"; do
  g secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$(sa pass-job)" \
    --role=roles/secretmanager.secretAccessor >/dev/null
done
note "datastore.user on the project · secretAccessor on ${SECRETS[*]}"

step "The Cloud Run Job '$JOB'"
if g run jobs describe "$JOB" --region="$REGION" >/dev/null 2>&1; then
  note "exists (the deploy workflow sets its image, args and environment)"
elif confirm "Create the job '$JOB' with a placeholder image?"; then
  # One task, no retries, and a timeout under the 10-minute schedule, so two
  # passes never overlap (ADR 0018 point 2).
  g run jobs create "$JOB" --region="$REGION" --image="$PLACEHOLDER_IMAGE" \
    --service-account="$(sa pass-job)" --tasks=1 --max-retries=0 \
    --task-timeout=540s
fi

step "The Scheduler trigger, every 10 minutes, paused"
g run jobs add-iam-policy-binding "$JOB" --region="$REGION" \
  --member="serviceAccount:$(sa pass-scheduler)" --role=roles/run.invoker >/dev/null
if g scheduler jobs describe "$JOB" --location="$REGION" >/dev/null 2>&1; then
  note "exists (state: $(g scheduler jobs describe "$JOB" --location="$REGION" --format='value(state)'))"
elif confirm "Create the trigger and pause it straight away?"; then
  g scheduler jobs create http "$JOB" --location="$REGION" \
    --schedule="*/10 * * * *" --time-zone=UTC --http-method=POST \
    --uri="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run" \
    --oauth-service-account-email="$(sa pass-scheduler)"
  g scheduler jobs pause "$JOB" --location="$REGION"
fi

step "The deploy account: push images, update this job, attach the job's account"
g artifacts repositories add-iam-policy-binding "$REGISTRY" --location="$REGION" \
  --member="serviceAccount:$(sa deployer)" --role=roles/artifactregistry.writer >/dev/null
g run jobs add-iam-policy-binding "$JOB" --region="$REGION" \
  --member="serviceAccount:$(sa deployer)" --role=roles/run.developer >/dev/null
g iam service-accounts add-iam-policy-binding "$(sa pass-job)" \
  --member="serviceAccount:$(sa deployer)" --role=roles/iam.serviceAccountUser >/dev/null
note "artifactregistry.writer on '$REGISTRY' · run.developer on '$JOB' · actAs pass-job"

step "Workload Identity Federation for GitHub Actions"
# Matched by numeric ids, which survive a rename or transfer of the repository.
REPO_ID=$(gh api "repos/$REPO_SLUG" --jq .id)
OWNER_ID=$(gh api "repos/$REPO_SLUG" --jq .owner.id)
if g iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1; then
  note "pool '$POOL' exists"
elif confirm "Create the workload identity pool '$POOL'?"; then
  g iam workload-identity-pools create "$POOL" --location=global \
    --display-name="GitHub Actions"
fi
if g iam workload-identity-pools providers describe "$PROVIDER" \
  --workload-identity-pool="$POOL" --location=global >/dev/null 2>&1; then
  note "provider '$PROVIDER' exists"
elif confirm "Create the provider '$PROVIDER' (this repository, on main only)?"; then
  g iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --workload-identity-pool="$POOL" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository_id=='$REPO_ID' && assertion.repository_owner_id=='$OWNER_ID' && assertion.ref=='refs/heads/main'"
fi
g iam service-accounts add-iam-policy-binding "$(sa deployer)" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/attribute.repository_id/$REPO_ID" >/dev/null
note "deployer can be impersonated by this repository's main branch only"

step "GitHub repository variables (not secrets: names, not credentials)"
WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL/providers/$PROVIDER"
if confirm "Set GCP_PROJECT_ID and GCP_WIF_PROVIDER on $REPO_SLUG?"; then
  gh variable set GCP_PROJECT_ID --repo "$REPO_SLUG" --body "$PROJECT"
  gh variable set GCP_WIF_PROVIDER --repo "$REPO_SLUG" --body "$WIF_PROVIDER"
fi

step "Done. Still by hand:"
note "1. Add each secret's value, without echoing it (the read is silent):"
for secret in "${SECRETS[@]}"; do
  note "   read -rs v && printf '%s' \"\$v\" | gcloud --configuration=satella --project=\"\$SATELLA_GCP_PROJECT\" secrets versions add $secret --data-file=- ; unset v"
done
note "2. Merge to main: CI builds the image and points the job at it."
note "3. Run it once on purpose; it should exit with SATELLA_NOT_CONFIGURED:"
note "   gcloud --configuration=satella run jobs execute $JOB --region=$REGION --wait"
note "The trigger stays paused until #9."
