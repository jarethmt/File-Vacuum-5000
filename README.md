# File Vacuum 5000 #

⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️

**WARNING: This script is designed to manipulate files on both an external drive and another specified mount point on your file system using the super user account. This can have devestating consequences with the wrong config. I am not responsible for any data loss caused by misuse of this tool. Test it out and make sure you know what it's doing and how it works before using it for important data. You have been warned.**

⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️

Import any disk into your computer automatically when it's plugged in. Designed to work with Ubuntu but should work with some other distros too. Written in Node.JS, File Vacuum detects newly plugged in disks, filters through all partitions, mounts them, and then checks for a "sync.json" file in the root of the drive. If the sync.json file is present, it pulls config from the file and beings an rsync of all files on the drive to the computer at a specified location.

Import hard drives, flash drives, or camera SD cards into your computer automatically by just plugging in the device. Email alerts on completion or error. Make your NAS server into a self-feeding file bucket, or install to your laptop for a quick and easy way to import drives.

## Full Usage ##

### Requirements ###
     - Node.JS
     - NPM
     - Yarn (but you could probably use NPM instead...)

MAKE SURE TO BE ROOT. You need root access for this script. It mounts and manipulates drives and filesystems, and root access is the easiest and cleanest way to do this. That means that the script needs to be started with sudo, and that pm2 should run the script as the root user if setting up auto boot.

First, clone the repo:

    git clone https://github.com/jarethmt/File-Vacuum-5000

Then install npm dependencies:

    yarn install

Now, create a file in the main app directory called "mailSettings.json", and fill it in with the following format, substituting your own email details:

    {
        "from":"SERVER NAME <server@yoururl.com>",
        "defaultRecipient": "youremail@yoururl.com",
        "server":{
            "host": "your.smtp.server.com",
            "port": 465,
            "secure": true,
            "auth": {
                "user": "your_email",
                "pass": "your_password"
            }
        }
    }

Start the server with `sudo node .` from the root directory of the project. You can also create a systemd job, or use pm2 in order to run this script in the background at boot. For example:

    sudo su
    yarn add pm2
    pm2 start ./index.js
    pm2 startup
    pm2 save

Which will use the Node.JS pm2 package to persist this application in the back end.

After everything is installed and configured, test it out by grabbing a flash drive and loading a few sample files on it. Then, create a sync.json file in the root directory of the flash drive with the following format / details:

    {
        email: your@email.com,
        syncPath: /home/$USER/last-import,
        deleteAfter: false,
        user: uid,
        group: gid,
        permissions: xxx
    }

Where uid is the user ID of the user you'd like the files to be owned by after sync is complete, same for gid. You can obtain these on Ubuntu with `id -u $USER` and `id -g $USER`. Permissions should be a [3 digit binary representation](https://docs.nersc.gov/filesystems/unix-file-permissions/)

Save this file, eject the drive, and then plug it back in, and you should see the script automatically copy everything over to your specified path on the computer! You'll receive a success email on completion. Even if you specify "true" for "deleteAfter", the sync.json will be preserved and left on the drive so that the next time you plug it in, it will sync again! Very useful for creating a physical drop box of sorts.


### TODO ###
 - Create a safety check on import folder. An array of folders defined in the script which can not be synced to, in order to protect sensitive system directories.
 - Fix script to allow drives without any partitions to be properly mounted / synced. Right now, the drive MUST have a partition to work properly.