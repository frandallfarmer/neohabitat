#!/bin/bash
# Updates VirtualBox guest additions.

set -euo pipefail

echo "Attempting to update VBoxAdditions..."

VERSION=$(curl http://download.virtualbox.org/virtualbox/LATEST.TXT)
echo "Updating VBoxAdditions for latest VirtualBox: ${VERSION}"

curl -so /tmp/additions.iso \
  http://download.virtualbox.org/virtualbox/${VERSION}/VBoxGuestAdditions_${VERSION}.iso

sudo mkdir -p /mnt/vboxadditions
sudo mount -o loop /tmp/additions.iso /mnt/vboxadditions || true

sudo bash -c "cd /mnt/vboxadditions && yes | sudo sh ./VBoxLinuxAdditions.run --nox11"
sudo /etc/init.d/vboxadd setup
