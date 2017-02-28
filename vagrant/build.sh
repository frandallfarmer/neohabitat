#!/bin/bash
# Installs dependent libraries then builds and sets up Neohabitat and all dependent
# services on an Ubuntu-class node.
# WARNING: No security is in use here whatsoever; use this in production at your peril.

set -eo pipefail

SHOULD_INSTALL_MARIADB="${VAGRANT_SHOULD_INSTALL_MARIADB-true}"

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

if [ "${SHOULD_INSTALL_MARIADB}" == true ]; then
  # Installs the MariaDB APT repository.
  sudo apt-get install software-properties-common
  sudo apt-key adv --recv-keys --keyserver hkp://keyserver.ubuntu.com:80 0xF1656F24C74CD1D8
  sudo add-apt-repository 'deb [arch=amd64,i386,ppc64el] http://sfo1.mirrors.digitalocean.com/mariadb/repo/10.1/ubuntu xenial main'
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
./build

# Installs Neohabitat MongoDB schema and models.
cd /neohabitat/db
make db

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
Restart=always
RestartSec=20
LimitNOFILE=16384

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
Environment=NEOHABITAT_SHOULD_BACKGROUND_BRIDGE=false
Environment=NEOHABITAT_SHOULD_RUN_BRIDGE=true
Environment=NEOHABITAT_SHOULD_RUN_NEOHABITAT=false
Restart=always
RestartSec=20
LimitNOFILE=16384

[Install]
WantedBy=multi-user.target
EOF

# Starts Neohabitat bridge and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable neohabitat-bridge.service
sudo systemctl start neohabitat-bridge.service

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
LimitNOFILE=16384

[Install]
WantedBy=multi-user.target
EOF

# Starts QuantumLink Reloaded and enables it for launch upon next boot.
sudo systemctl daemon-reload
sudo systemctl enable qlink.service
sudo systemctl start qlink.service

echo "Successfully provisioned Neohabitat. Happy hacking!"
exit 0
