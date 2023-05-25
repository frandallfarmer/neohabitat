# In-world bots for Neohabitat
#
# VERSION              0.1.0

FROM centos:7

# Ensures that the codebase is homed at /habibots.
ADD . /habibots

# Installs base build dependencies.
RUN yum -y install \
  cronie \
  curl \
  git \
  htop \
  make \
  tar \
  vim \
  wget \
  which && \
  yum clean all

# Installs the Nodesource Yum repository.
RUN curl -sL https://rpm.nodesource.com/setup_7.x | bash -

# Installs Node.
RUN yum -y install \
  nodejs && \
  yum clean all

# Installs Node dependencies.
RUN npm install -g supervisor

# Builds the Neohabitat project.
WORKDIR /habibots
RUN npm install

ENTRYPOINT /habibots/run
