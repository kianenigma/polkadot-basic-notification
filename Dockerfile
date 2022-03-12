FROM nikolaik/python-nodejs:python3.10-nodejs17-alpine
WORKDIR /app/

COPY package.json yarn.lock ./
RUN yarn --frozen-lockfile

COPY . .
CMD yarn run start -c $CONF
