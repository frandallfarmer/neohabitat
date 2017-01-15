# -*- mode: ruby -*-
# vi: set ft=ruby :

# If we're running on Windows, ensures that VBOX_INSTALL_PATH is appropriately set.
if Gem.win_platform?
  ENV["VBOX_INSTALL_PATH"] = "C:\\Program Files\\Oracle\\VirtualBox\\"
end

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/trusty64"

  config.vm.network "forwarded_port", guest: 1337, host: 1337
  config.vm.network "forwarded_port", guest: 3307, host: 3307
  config.vm.network "forwarded_port", guest: 5190, host: 5190
  config.vm.network "forwarded_port", guest: 9000, host: 9000
  config.vm.network "forwarded_port", guest: 27017, host: 27017

  config.vm.provider :virtualbox do |vb|
    vb.customize ["setextradata", :id, "VBoxInternal2/SharedFoldersEnableSymlinksCreate/vagrant", "1"]
    vb.customize ["modifyvm", :id, "--memory", "1024"]
    vb.customize ["modifyvm", :id, "--cpus", "2"]
  end

  $run_docker_compose = "cd /vagrant && docker-compose up"

  # Explicitly enforces syncing of the local folder to /vagrant on the VM.
  config.vm.synced_folder ".", "/vagrant"

  # Updates VBox guest additions to the latest version of VirtualBox then reboots the VM.
  config.vm.provision :shell, binary: true, path: "./script/update_vbox_additions.sh"
  config.vm.provision :reload

  if Gem.win_platform?
    # Handles Windows-style line endings.
    config.vm.provision :docker
    config.vm.provision :docker_compose
    config.vm.provision :shell, binary: true, inline: $run_docker_compose
  else
    config.vm.provision :docker
    config.vm.provision :docker_compose, yml: "/vagrant/docker-compose.yml", run: "always"
  end
end
