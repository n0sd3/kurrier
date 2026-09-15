FROM node:24.20.0-alpine AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install

WORKDIR /repo/apps/worker
ENV NITRO_PRESET=node-server
RUN pnpm run build

# nodemailer picks its transport with a require() keyed by a runtime string
# (smtp-transport, ses-transport, ...), which node-file-trace can't follow —
# nitro's traced copy above ends up missing those files. Overwrite it with
# the real, complete package from this stage's own install.
RUN NM_DIR="$(node -e "console.log(require.resolve('nodemailer/package.json').replace('/package.json',''))")" && \
	rm -rf .output/server/node_modules/nodemailer && \
	cp -r "$NM_DIR" .output/server/node_modules/nodemailer

FROM node:24.20.0-alpine
WORKDIR /app

RUN apk add --no-cache postgresql-client bash
COPY db/init/db-bootstrap.sh /scripts/db-bootstrap.sh
COPY db/init/migrations /scripts/migrations
RUN chmod +x /scripts/db-bootstrap.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

COPY apps/worker/package.json ./package.json
COPY pnpm-lock.yaml ./pnpm-lock.yaml
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate && pnpm install --prod

COPY --from=build /repo/apps/worker/.output ./.output

EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
