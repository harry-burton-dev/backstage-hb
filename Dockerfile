# The portal's image: built from source in one go (CI's build.yml, or `docker build .`), so no
# host steps are needed first. Based on https://backstage.io/docs/deployment/docker#multi-stage-build

# Stage 1: the package.json skeleton, so installs are cached until a dependency changes.
FROM node:24-trixie-slim AS packages
WORKDIR /app
COPY backstage.json package.json yarn.lock ./
COPY .yarn ./.yarn
COPY .yarnrc.yml ./
COPY packages packages
COPY plugins plugins
RUN find packages plugins \! -name "package.json" -mindepth 2 -maxdepth 2 -exec rm -rf {} \+

# Stage 2: build the backend bundle (it carries the frontend).
FROM node:24-trixie-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app
COPY --from=packages --chown=node:node /app .
RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --immutable
COPY --chown=node:node . .
RUN yarn tsc
RUN yarn --cwd packages/backend build
RUN mkdir packages/backend/dist/skeleton packages/backend/dist/bundle \
    && tar xzf packages/backend/dist/skeleton.tar.gz -C packages/backend/dist/skeleton \
    && tar xzf packages/backend/dist/bundle.tar.gz -C packages/backend/dist/bundle

# Stage 3: what runs. MkDocs builds TechDocs in here, so the server needs no Docker socket for it.
FROM node:24-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv g++ build-essential libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/mkdocs \
    && /opt/mkdocs/bin/pip install --no-cache-dir mkdocs-techdocs-core==1.6.0
ENV PATH="/opt/mkdocs/bin:${PATH}"
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml /app/backstage.json ./
COPY --from=build --chown=node:node /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton/ ./
RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle/ ./
COPY --chown=node:node app-config*.yaml ./
COPY --chown=node:node org ./org
COPY --chown=node:node templates ./templates
RUN mkdir -p /app/techdocs
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"
# app-config.github.yaml only once the GitHub OAuth app is set up (README.md, "Git Release Manager"):
# a GitHub provider without its client ID stops the backend from starting.
# app-config.email.yaml only once SMTP is set (README.md, "Late reports").
CMD ["sh", "-c", "exec node packages/backend --config app-config.yaml --config app-config.production.yaml ${GITHUB_OAUTH_CLIENT_ID:+--config app-config.github.yaml} ${SMTP_HOST:+--config app-config.email.yaml}"]
