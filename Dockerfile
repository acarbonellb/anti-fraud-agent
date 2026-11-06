# The scheduled pass as a Cloud Run Job (ADR 0018). It runs the same entry point
# as `pnpm pass` on a laptop, through tsx, with no build step. The Node major
# matches CI.
#
# Both stages pin the base by digest (the multi-arch index) with the tag kept
# for readers: a tag moves, so the same commit could otherwise build a
# different image. Dependabot moves the digest through a PR (ADR 0018,
# amendment of #85).

# Dependencies: the runtime ones only (tsx among them), from the lockfile.
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS deps
WORKDIR /app
# The pnpm that `packageManager` names, installed with npm instead of corepack,
# so the build doesn't depend on corepack's signing keys.
RUN npm install --global pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts skips the husky `prepare` hook, a dev dependency.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# The image the job runs: no package manager, no dev dependencies.
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
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
