# -*- mode: ruby -*-
# vi: set ft=ruby :

# If we're running on Windows, ensures that VBOX_INSTALL_PATH is appropriately set.
if Gem.win_platform?
  ENV["VBOX_INSTALL_PATH"] = "C:\\Program Files\\Oracle\\VirtualBox\\"
end

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/xenial64"

  config.vm.network "forwarded_port", guest: 1337, host: 1337
  config.vm.network "forwarded_port", guest: 3307, host: 3307
  config.vm.network "forwarded_port", guest: 5190, host: 5190
  config.vm.network "forwarded_port", guest: 9000, host: 9000
  config.vm.network "forwarded_port", guest: 27017, host: 27017

  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--memory", "1024"]
    vb.customize ["modifyvm", :id, "--cpus", "2"]
  end

  # Explicitly enforces syncing of the local folder to /vagrant on the VM.
  config.vm.synced_folder ".", "/neohabitat"

  if Gem.win_platform?
    config.vm.provision :shell, binary: true, path: "./vagrant/build.sh"
  else
    config.vm.provision :shell, path: "./vagrant/build.sh"
  end
end
