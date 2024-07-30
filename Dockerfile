# Neoclassical Habitat
#
# VERSION              0.1.0

FROM quay.io/centos/centos:stream9

# Installs MongoDB Yum repository.
ADD ./tools/mongodb.repo /etc/yum.repos.d/mongodb.repo

# Get a recent version of nodejs
RUN curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -

# Installs base build dependencies.
RUN yum -y install \
  cronie \
  git \
  java-1.8.0-openjdk \
  make \
  mariadb \
  vim \
  wget \
  which \
  maven \
  mongodb-org \
  nsolid && \
  yum clean all

# Installs Node dependencies.
RUN npm install -g supervisor

# Ensures that the codebase is homed at /neohabitat.
COPY . /neohabitat

# Adds a container log tailing utility.
RUN printf '#!/bin/bash\ntail -f /neohabitat/{bridge,elko_server}.log' > /usr/bin/habitail && chmod a+x /usr/bin/habitail

# Adds a cronjob to enable the updating of the Hall of Records.
RUN printf "*/5 * * * * root /bin/bash -c 'cd /neohabitat/db && NEOHABITAT_MONGO_HOST=neohabitatmongo:27017 make book' >> /var/log/hallofrecords.log\n" > /etc/cron.d/hall-of-records

# Builds the Neohabitat project.
WORKDIR /neohabitat
RUN rm -rf lib && mvn clean package
RUN npm ci

WORKDIR /neohabitat/pushserver
RUN npm ci

WORKDIR /neohabitat
ENTRYPOINT /neohabitat/run

EXPOSE 1337 1701 1986 1987 2018 3000 9000
