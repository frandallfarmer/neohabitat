# Neoclassical Habitat
#
# VERSION              0.1.0

FROM philcollins/aurora-centos7

# Ensures that the codebase is homed at /neohabitat.
ADD . /neohabitat

# Installs base build dependencies.
RUN yum -y install \
  cronie \
  curl \
  git \
  java-1.8.0-openjdk \
  make \
  mariadb \
  tar \
  wget \
  which && \
  yum clean all

# Installs the Apache Maven Yum repository.
RUN wget http://repos.fedorapeople.org/repos/dchen/apache-maven/epel-apache-maven.repo -O /etc/yum.repos.d/epel-apache-maven.repo

# Installs the Nodesource Yum repository.
RUN curl -sL https://rpm.nodesource.com/setup_6.x | bash -

# Installs MongoDB Yum repository.
RUN curl -sL https://goo.gl/CxNbGr > /etc/yum.repos.d/mongodb-org.3.4.repo

# Installs Node and MongoDB.
RUN yum -y install \
  apache-maven \
  mongodb-org \
  nodejs && \
  yum clean all

# Installs Node dependencies.
RUN npm install -g supervisor

# Adds a container log tailing utility.
RUN printf '#!/bin/bash\ncat /proc/$(pgrep java)/fd/{1,2} /proc/$(pgrep -f node)/fd/{1,2}' > /usr/bin/habitail && chmod a+x /usr/bin/habitail

# Adds a cronjob to update the Hall of Records.
RUN printf "*/10 * * * * root /bin/bash -c 'cd /neohabitat/db && make book'" > /etc/cron.d/hall-of-records

# Builds the Neohabitat project.
WORKDIR /neohabitat
RUN rm -rf lib && npm install && ./build

ENTRYPOINT /neohabitat/run

EXPOSE 1337 9000
