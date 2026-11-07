# ADR 0018 — The pass runs as a Cloud Run Job in its own project, deployed from CI without keys and shipped paused

- **Date:** 2026-11-05
- **Status:** accepted · amendment 2026-11-05 (#9) · amendment 2026-11-07 (#85)
- **Related:** brief §8 (deployment) and §6.3 (spend caps); ADR 0008 (the deployed model, amended
  here for the Tailscale decision); ADR 0016 (the store); ADR 0017 (the pass); issues #8, #46
  and #9.

## Context

The pass (ADR 0017, `pnpm pass`) is a short process: it reads Satella's feed, reviews up to 10
subjects, stores each run and exits. It runs every 10 minutes and holds no state of its own, since
the cursor, the runs and the day's spend live in Firestore (ADR 0016). Brief §8 places it on GCP as
a Cloud Run Job with Cloud Scheduler, with its keys in Secret Manager and a service account of its
own.

Four facts shaped the rest:

- **The model is paid.** The deployed agent runs Claude Haiku 5.5 (ADR 0008, amendment of #42),
  about $0.002 a review. The Anthropic key has a spend cap at the provider, which is the hard limit
  (brief §6.3). The day's budget in the store (ADR 0017) is the soft one.
- **Satella staging isn't connected yet** (#9). Until it is, the pass has nothing to call:
  without Satella's configuration it exits 1 before reading anything (`SATELLA_NOT_CONFIGURED`).
- **The repo is public-bound.** No project id, account, service account email or host may be
  committed (CLAUDE.md §1).
- **The author already deploys another project to GCP from GitHub Actions** with Workload Identity
  Federation and no stored keys. That setup is known to work, and its lessons carry over. Hosting
  rewrites don't stream and time out at 60 s. In-memory guardrails are wrong on Cloud Run, since
  instances scale to zero. The deploy account needs Service Usage Viewer for firebase-tools.

## Decision

1. **A GCP project of its own, under a Satella Google account, in `europe-west1`.** It is kept
   apart from the author's other projects, so its billing, IAM and budget alert answer to this
   agent only. Locally the project is reached only through the `satella` gcloud configuration,
   pinned to this checkout by direnv in a file git ignores. `europe-west1` offers Cloud Run,
   Cloud Scheduler, Firestore and Artifact Registry, and it is Tier 1 for Cloud Run. Firestore's
   location can't change once the database exists.
2. **The pass is a Cloud Run Job: one task, no retries, a timeout under the schedule's
   interval.**
   - **No retries.** A failed pass has already stored its failed runs and moved the cursor
     (ADR 0017). A retry would only spend again, and the next pass comes 10 minutes later anyway.
   - **A timeout under 10 minutes.** Two executions never overlap, so two passes never read the
     same cursor.
   - **Command.** The job runs the pass with `--paid`. `--paid` is the author's go-ahead to call a
     paid provider (ADR 0008, amendment of #30). Here it sits in reviewed deploy config, not in
     someone's shell.
3. **Cloud Scheduler starts it every 10 minutes, and the trigger ships paused.** The trigger
   calls the Cloud Run Admin API with the token of its own service account. That account may only
   run this job. It stays paused until #9 gives the pass a Satella. Until then, a manual
   execution may be run on purpose to check that the image starts and exits cleanly with
   `SATELLA_NOT_CONFIGURED`. Resuming the trigger is #9's step, with the author's go-ahead.
4. **The image runs the same entry point as local.**
   - **Base and user.** Node 22 slim and a non-root user. The runtime dependencies come from
     the frozen lockfile, and `tsx` is one of them. The image runs `scripts/pass.ts` through
     `tsx`, as `pnpm pass` does on a laptop, with no package manager in it.
   - **Repository.** Images go to an Artifact Registry Docker repository in the same region. Each
     is tagged with the commit SHA, and a cleanup policy keeps the last few.
5. **Two secrets in Secret Manager, set by the author, read only by the job.**
   - **What.** `AGENT_LLM_API_KEY` (the demo Anthropic key with its spend cap) and
     `TAVILY_API_KEY`. The job reads them as environment variables.
   - **Who sets them.** The author, piping the value into `gcloud` (`env-var` skill). The values
     never pass through the agent's output, CI or the repo.
   - **Satella.** Its credential joins them in #9.
6. **One service account per role, with the fewest roles.**
   - **Job.** `roles/datastore.user` on the project, and `roles/secretmanager.secretAccessor` on
     its two secrets only. Satella identifies the agent through this account (brief §3.1, #9).
   - **Scheduler.** `roles/run.invoker` on the job only.
   - **Deploy.** It pushes images to the repository, updates the job, and acts as the job's
     account only to attach it. It can't change IAM, secrets or the trigger.
   - **Who changes the rest.** IAM, the trigger's state and the secrets change by hand, by the
     author.
7. **CI deploys on `main` through Workload Identity Federation, with no stored key.**
   - **Who may deploy.** GitHub's OIDC token is exchanged for the deploy account. The provider
     accepts only this repository, matched by repository and owner id rather than by name, on
     `refs/heads/main`.
   - **When.** The deploy job runs after the existing checks pass on a push to `main`. One deploy
     runs at a time.
   - **What it does.** It builds the image, pushes it and points the job at it.
   - **Configuration.** The project id and the WIF provider's name are GitHub repository variables; the deploy account's email follows from the project id. The
     job's non-secret environment lives in the workflow, so a change to it is reviewed in a PR:
     the provider, model and effort of ADR 0008, `FIRESTORE_PROJECT_ID` and the budget.
8. **The one-time setup is gcloud commands the author runs, kept in the repo without ids.**
   - **What.** Firestore, the registry, the secrets' containers, the service accounts and their
     roles, the WIF pool and provider, the job and its paused trigger.
   - **How.** A committed, idempotent script reads the project and region from the environment.
     Each resource is created only with the author's go-ahead (CLAUDE.md §8).
9. **Logs are the pass's JSON lines, read by Cloud Logging.** Each line keeps only ids and codes
   (CLAUDE.md §4). Cloud Logging maps a `severity` field to the entry's level, so the pass writes
   it next to `level`.

## Alternatives rejected

- **Reach the author's LM Studio over Tailscale** (#8's interim plan). The deployed agent would
  depend on the author's laptop being on and the tailnet up. It would also need `tailscaled` in
  the container, an ACL and an ephemeral auth key: three moving parts for a review that costs
  $0.002 on Haiku. ADR 0008's amendment for #46 records that this is superseded.
- **A Cloud Run service with an HTTP endpoint the Scheduler calls.** A service fits a request
  that answers within its timeout. A pass is a batch with no caller waiting, which is what jobs
  are for. A service would also need an authenticated endpoint that nobody else should hit.
  Brief §8 keeps the service for the dashboard (#47, on hold).
- **A service account key in a GitHub secret.** A long-lived key that can leak and must be
  rotated. WIF issues a short-lived token per run and needs no secret.
- **Terraform.** It would need a state bucket and a provider to learn, for about a dozen
  resources created once. A reviewed gcloud script is enough at this size and shows every
  command. It's worth revisiting if the setup grows past a single job.
- **The author's existing GCP project.** It would mix this agent's billing, IAM and budget alert
  with another project. Its free tiers would be shared, and its permissions would reach Satella's
  agent.
- **A compile step for the image.** The repo type-checks without emitting (`noEmit`). A build only
  the image used would be a second way to run the pass. `tsx` adds well under a second to a job
  that runs for minutes at most.

## Consequences

- **Cost.**
  - **The model.** Every pass that reviews spends on Haiku, bounded by the day's budget and the
    provider's cap.
  - **GCP.** It should stay within the free tiers. A pass with an empty feed runs a few seconds,
    and Firestore's daily quota is far above 144 passes a day. The budget alert on the project
    reports anything else.
- **The deployed agent does nothing until #9.** That is on purpose: the image, IAM and deploy
  path are proven first, and the trigger is resumed when there is a Satella to call.
- **A config change is a PR.** The model, effort and budget the agent runs with are reviewed and
  deployed like code. A newer eval winner changes the deployed model through the workflow
  (ADR 0008, amendment of #42).
- **Deploys can't widen their own permissions.** A compromised workflow could replace the image,
  but couldn't grant itself roles, read the secrets or resume the trigger. (Wrong about the
  secrets: replaced by the amendment of #85.)
- **Left open:**
  - the dashboard's service and its service account (#47, on hold);
  - Satella's credential and a bypass token for staging's deployment protection, if it needs one (brief §8, #9);
  - alerting on failed passes beyond the budget alert.

## Amendment (2026-11-05, #9): the pass reaches Satella staging with its identity token

How the deployed pass connects to Satella staging. It extends points 5 and 6 and closes the
first item left open.

1. **The job's account is the agent's identity before Satella.**
   - **The token.** The pass asks the Cloud Run metadata server for a Google identity token of
     `pass-job`, with `aud` = `SATELLA_AGENT_API_AUDIENCE` and `format=full`. Satella requires
     the `email` and `email_verified` claims, and only the full format carries them.
   - **Reuse.** The token is reused until a minute before its `exp`. The agent reads `exp`
     without verifying the signature: Satella is the verifier.
   - **On Satella's side.** Satella lists `pass-job`'s email, with `agent:read` and
     `agent:recommend`, in its agent API credentials, under the same audience. That
     configuration lives in Satella's environment, not here.
2. **Satella's origin and audience are secrets, although neither is a credential.** This
   replaces "two secrets" in point 5 with four: `SATELLA_STAGING_BASE_URL` and
   `SATELLA_AGENT_API_AUDIENCE` join them.
   - **Why.** As repository variables, both would be printed in the deploy step's log. That log
     becomes public with the repository, and the staging host may not appear anywhere public
     (CLAUDE.md §1).
   - **Who sets them.** The author adds their values the way the keys were added.
3. **No bypass token.** Staging has no deployment protection (checked 2026-11-05): an
   unauthenticated call reaches the app's own 401. Brief §8's assumption doesn't apply.
4. **The pass picks its Satella at startup.**
   - **`--mock`.** It reviews the in-process mock.
   - **Configured.** Without `--mock`, and with both Satella variables set, it reviews staging.
   - **Half configured.** One variable without the other fails at startup.
   - **Unconfigured.** With neither variable, it exits with `SATELLA_NOT_CONFIGURED`, as before.
5. **The trigger is resumed after one pass run on purpose.** A manual execution against staging
   must end in `pass.report` before the Scheduler is resumed, and resuming it is the author's
   go-ahead.

**Rejected:**

- **A bearer token for the deployed agent.** Brief §3.1 keeps it for local development. It is a
  secret that would have to be stored and rotated, which the identity token avoids.
- **Google's auth library.** It reads application default credentials, which this repo never
  does (ADR 0016). A single metadata-server call is all the job needs.

**Left open:**

- loading the eval dataset into staging through the app's flows (brief §5, doubt 2 of §10): #53;
- the brief §7 checks before any third party sees staging (doubts 4 and 5 of §10): #54.

## Amendment (2026-11-07, #85): the deploy account holds the job's secrets in effect, and `main` is the boundary

Replaces the consequence "Deploys can't widen their own permissions". It said a compromised
workflow couldn't read the secrets. That was wrong. It also pins what the deploy job runs.

1. **The deploy account is equivalent to the job's secrets.** The deploy step sets the job's
   image, its environment and its secret bindings (point 7). A malicious image deployed from
   `main` runs as `pass-job` and reads all four secrets on its next execution, within 10 minutes
   once the trigger runs. Changing the environment could also point the pass at another host.
   What the deploy account still can't do is change IAM, add secret versions or resume the
   trigger (point 6).
2. **`main` is the boundary.** Only a run on `refs/heads/main` of this repository gets the deploy
   account (point 7). Code reaches `main` only through `main`'s ruleset: a PR is required, the
   checks must pass, force pushes are blocked, and a code owner must review. `.github/CODEOWNERS`
   names the author on the workflows, the `Dockerfile`, `scripts/gcp/` and the CODEOWNERS file
   itself, the files that decide what is deployed and with what. With one maintainer, code-owner
   review adds no second reviewer. It makes the ownership explicit and keeps it if collaborators
   join.
3. **What runs with the deploy account is pinned.** Every action in the workflow is pinned to a
   full commit SHA with its release in a comment. The base image is pinned by its multi-arch
   digest in both stages of the `Dockerfile`. A moved tag would otherwise run someone else's code
   with the deploy account, or build a different image from the same commit.
4. **Dependabot moves the pins.** `.github/dependabot.yml` checks `github-actions` and `docker`
   weekly and opens a PR for each new SHA or digest, which goes through the same ruleset. Security
   alerts stay off, as decided in #40.

**The author's steps, outside the repo:**

- add "Require review from Code Owners" to `main`'s ruleset;
- enable Dependabot version updates in the repository settings, if the config file alone doesn't
  start them.

**Rejected:**

- **Pin by tag and trust the publishers.** The tags are mutable, and the action that exchanges the
  OIDC token gets the deploy account. A SHA costs a Dependabot PR now and then.
- **Narrow the deploy account so it can't touch secret bindings.** `gcloud run jobs update` sets
  the image, and the image alone reads the secrets the job already binds. A narrower role would
  not change what a malicious image can read.
