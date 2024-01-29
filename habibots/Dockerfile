# In-world bots for Neohabitat
#
# VERSION              0.1.0
FROM node:18.19
COPY . /habibots
WORKDIR /habibots
RUN npm install -g supervisor
RUN npm ci
RUN apt-get update && apt-get install -y netcat-openbsd
ENTRYPOINT /habibots/run
