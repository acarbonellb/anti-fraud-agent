# The scheduled pass as a Cloud Run Job (ADR 0018). It runs the same entry point
# as `pnpm pass` on a laptop, through tsx, with no build step. The Node major
# matches CI.
#
# Both stages pin the base by digest (the multi-arch index) with the tag kept
# for readers: a tag moves, so the same commit could otherwise build a
# different image. Dependabot moves the digest through a PR (ADR 0018,
# amendment of #85).

# Dependencies: the runtime ones only (tsx among them), from the lockfile.
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS deps
WORKDIR /app
# The pnpm that `packageManager` names, installed with npm instead of corepack,
# so the build doesn't depend on corepack's signing keys.
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts skips the husky `prepare` hook, a dev dependency.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# The image the job runs: no package manager, no dev dependencies.
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
USER node
# Flags come from the job's args (`--paid`, set in the deploy workflow). No
# `.env` ships in the image: Cloud Run sets the environment.
ENTRYPOINT ["node", "--import", "tsx", "scripts/pass.ts"]
