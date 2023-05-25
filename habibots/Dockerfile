# In-world bots for Neohabitat
#
# VERSION              0.1.0
FROM node:18.16

COPY . /habibots
WORKDIR /habibots
RUN npm install -g supervisor
RUN npm ci
ENTRYPOINT /habibots/run
