#!/bin/bash
# Installs dependent libraries then builds and sets up Neohabitat and all dependent
# services on an Ubuntu-class node.
# WARNING: No security is in use here whatsoever; use this in production at your peril.

set -eo pipefail

# Disable TTY settings because Vagrant.
sed -i 's/^mesg n$/tty -s \&\& mesg n/g' /root/.profile

SHOULD_INSTALL_MARIADB="${VAGRANT_SHOULD_INSTALL_MARIADB-true}"
VAGRANT_CUSTOM_MOUNT_LOCATION='/media/sf_neohabitat'

PACKAGES=(
  build-essential
  curl
  default-jdk
  git
  maven
  mongodb-org
  mongodb-org-mongos
  mongodb-org-shell
  mongodb-org-server
  mongodb-org-tools
  nodejs
)

# Handles Vagrant inexplicably overriding our mount directory into /media/sf_<volumename>.
if [ -d "${VAGRANT_CUSTOM_MOUNT_LOCATION}" ]; then
  ln -s "${VAGRANT_CUSTOM_MOUNT_LOCATION}" /neohabitat
fi

if [ "${SHOULD_INSTALL_MARIADB}" == true ]; then
  # Installs the MariaDB APT repository.
  sudo apt-get install software-properties-common
  sudo apt-key adv --recv-keys --keyserver hkp://keyserver.ubuntu.com:80 0xF1656F24C74CD1D8
  sudo add-apt-repository 'deb [arch=amd64,i386,ppc64el] https://archive.mariadb.org/mariadb-10.1/repo/ubuntu xenial main'
fi

# Installs the MongoDB APT repository.
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 0C49F3730359A14518585931BC711F9BA15703C6
echo "deb [ arch=amd64,arm64 ] http://repo.mongodb.org/apt/ubuntu xenial/mongodb-org/3.4 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-3.4.list

# Updates repository listings.
sudo apt-get update

# Installs NodeJS 6.x repository.
curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -

# Installs all Neohabitat dependencies, forcing noninteractivity to disable prompts.
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get -q -y install "${PACKAGES[@]}"
if [ "${SHOULD_INSTALL_MARIADB}" == true ]; then
  sudo -E apt-get -q -y install mariadb-server
fi

sudo npm install -g supervisor

# Writes a Systemd startup script for MongoDB because the package does not include it.
cat <<EOF | sudo tee /etc/systemd/system/mongodb.service
[Unit]
Description=High-performance, schema-free document-oriented database
After=network.target

[Service]
User=mongodb
ExecStart=/usr/bin/mongod --quiet --config /etc/mongod.conf

[Install]
WantedBy=multi-user.target
EOF

# Starts MongoDB and MariaDB and configures them for relaunch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable mongodb.service
sudo systemctl start mongodb.service
sudo systemctl start mysql.service

# Launches the Neohabitat build process.
cd /neohabitat
npm install --no-bin-links
mvn clean package

# Brings in Pushserver dependencies.
cd /neohabitat/pushserver
npm install --no-bin-links

# Installs Neohabitat MongoDB schema and models.
cd /neohabitat/db
make clean

# Clones the QuantumLink Reloaded codebase.
cd /neohabitat
if [ ! -e './data/qlink' ]; then
  git clone https://github.com/ssalevan/qlink data/qlink
fi

# Builds QuantumLink Reloaded.
cd ./data/qlink
git pull || true
./bootstrap
./package

# Writes a Systemd service for Neohabitat.
cat <<EOF | sudo tee /etc/systemd/system/neohabitat.service
[Unit]
Description=Neoclassical Habitat server
After=network.target
Wants=network.target

[Service]
WorkingDirectory=/neohabitat
ExecStart=/neohabitat/run
Environment=NEOHABITAT_MONGO_HOST=127.0.0.1:27017
Environment=NEOHABITAT_SHOULD_RUN_BRIDGE=false
Environment=NEOHABITAT_SHOULD_RUN_NEOHABITAT=true
Environment=NEOHABITAT_SHOULD_RUN_PUSHSERVER=false
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF

# Starts Neohabitat and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable neohabitat.service
sudo systemctl start neohabitat.service

cat <<EOF | sudo tee /etc/systemd/system/neohabitat-bridge.service
[Unit]
Description=Neohabitat to Habitat protocol bridge
After=network.target
Wants=network.target

[Service]
WorkingDirectory=/neohabitat
ExecStart=/neohabitat/run
Environment=NEOHABITAT_MONGO_HOST=127.0.0.1:27017
Environment=NEOHABITAT_BRIDGE_ELKO_HOST=127.0.0.1:2018
Environment=NEOHABITAT_SHOULD_BACKGROUND_BRIDGE=false
Environment=NEOHABITAT_SHOULD_RUN_BRIDGE=true
Environment=NEOHABITAT_SHOULD_RUN_NEOHABITAT=false
Environment=NEOHABITAT_SHOULD_UPDATE_SCHEMA=false
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF

# Starts Neohabitat bridge and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable neohabitat-bridge.service
sudo systemctl start neohabitat-bridge.service

cat <<EOF | sudo tee /etc/systemd/system/neohabitat-pushserver.service
[Unit]
Description=Neohabitat to Habitat protocol pushserver
After=network.target
Wants=network.target

[Service]
WorkingDirectory=/neohabitat/pushserver
ExecStart=/usr/bin/npm run debug
Environment=NODE_ENV=development
Environment=PUSH_SERVER_CONFIG=./config.vagrant.yml
Environment=PUSH_SERVER_MONGO_URL=mongodb://127.0.0.1
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF

# Starts Neohabitat pushserver and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable neohabitat-pushserver.service
sudo systemctl start neohabitat-pushserver.service

# Writes a Systemd service for QuantumLink Reloaded.
cat <<EOF | sudo tee /etc/systemd/system/qlink.service
[Unit]
Description=QuantumLink Reloaded server
After=network.target
Wants=network.target

[Service]
WorkingDirectory=/neohabitat/data/qlink
ExecStart=/neohabitat/data/qlink/run
Environment=QLINK_DB_HOST=127.0.0.1
Environment=QLINK_DB_JDBC_URI=jdbc:mysql://127.0.0.1:3306/qlink
Environment=QLINK_DB_USERNAME=qlinkuser
Environment=QLINK_DB_PASSWORD=qlinkpass
Environment=QLINK_HABITAT_HOST=127.0.0.1
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF

# Starts QuantumLink Reloaded and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable qlink.service
sudo systemctl start qlink.service

echo "Successfully provisioned Neohabitat. Happy hacking!"
exit 0
