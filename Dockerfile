FROM nikolaik/python-nodejs:python3.10-nodejs17-alpine
WORKDIR /app/

# RUN apt-get update || : && apt-get install python -y

COPY package.json yarn.lock ./
RUN yarn --frozen-lockfile

COPY . .
CMD yarn start
