FROM philcollins/aurora-centos7

ADD . /neohabitat

# Installs base build dependencies.
RUN yum -y install \
  curl \
  git \
  java-1.8.0-openjdk \
  make \
  mariadb \
  tar \
  wget && \
  yum clean all

# Installs the Nodesource Yum repository.
RUN curl -sL https://rpm.nodesource.com/setup_5.x | bash -

# Installs MongoDB Yum repository.
RUN curl -sL https://goo.gl/CxNbGr > /etc/yum.repos.d/mongodb-org.3.4.repo

# Installs Node and MongoDB.
RUN yum -y install \
  mongodb-org \
  nodejs && \
  yum clean all

# Installs Node dependencies.
RUN npm install -g \
  supervisor \
  yargs \
  winston

# Builds the Neohabitat project.
WORKDIR /neohabitat
RUN ./package

ENTRYPOINT /neohabitat/run

EXPOSE 1337 9000
