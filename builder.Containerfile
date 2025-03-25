# Base Stage
# --------------------
FROM node:lts-alpine as base

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package*.json ./

# Source Stage
# --------------------
FROM base as source

ARG NODE_ENV=development
ENV NODE_ENV=${NODE_ENV}

RUN npm ci --ignore-scripts

#COPY --chown=node:node .eslintrc.json ./
COPY --chown=node:node tsconfig*.json ./
COPY --chown=node:node ./src ./src


# Testing and Linting
# --------------------
#FROM source as testing
#
## RUN npm run test
#RUN npm run lint


# Typescript Compilation
# --------------------
FROM source as builder

# Compile src/*.ts into dist/*.js
RUN npm run build


# Pre Production
# --------------------
FROM base as preprod

ARG APP_CONFIG_FILE=/config/config.json
ENV APP_CONFIG_FILE=${APP_CONFIG_FILE}

ARG APP_LOG_LEVEL=info
ENV APP_LOG_LEVEL=${APP_LOG_LEVEL}

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

RUN npm ci --ignore-scripts
COPY --from=builder /app/dist ./dist

# Production
# --------------------
FROM preprod as production

#health probe
EXPOSE 3000

VOLUME ["/config"]
CMD ["node", "dist/index.js"]
