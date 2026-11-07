# Architecture

How a review flows is in the [README](../README.md#how-a-review-works); the decisions behind each
piece are in [`adr/`](adr/). This page maps the code and the deployment.

## Code layout

| Directory             | What it holds                                                                  |
| --------------------- | ------------------------------------------------------------------------------ |
| `src/pass/`           | The scheduled pass, its retry queue and its log lines                          |
| `src/agent/`          | `reviewSubject`, the model loop, the autonomy policy, the prompt and tools     |
| `src/checks/`         | Checks that run before the model (one with a web search), and their vocabulary |
| `src/venue/`          | Venue existence and capacity, from OpenStreetMap (Nominatim) and Wikidata      |
| `src/search/`         | Web search (Tavily) and authored pages for fictitious eval entities            |
| `src/providers/`      | One provider-neutral interface; Claude and OpenAI-compatible adapters          |
| `src/satella-client/` | Satella's agent API: client, Zod schemas, identity token and a mock server     |
| `src/store/`          | The agent's store: Firestore over REST and an in-memory twin                   |
| `src/evals/`          | The eval runner, recording and replay, metrics, charts and the CI gate         |
| `src/wiring/`         | The composition root: what every entry point builds a review with              |
| `src/config/`         | Environment variables, read once and validated with Zod                        |
| `src/test-support/`   | Test doubles, kept out of the deployed image                                   |

## Deployment

The pass runs as a Cloud Run Job, started every 10 minutes by Cloud Scheduler. CI deploys it from
`main` with Workload Identity Federation, so no service-account key exists. The job reaches Satella
with its Google identity token, keeps runs in Firestore, and reads its API keys and Satella's
address from Secret Manager ([ADR 0018](adr/0018-pass-runs-as-cloud-run-job-deployed-keyless.md)). Spend is
capped twice: by the daily budget in code and by the provider key's own limit.
