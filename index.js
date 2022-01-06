import { checkSudo } from 'check-sudo'
import { createRequire } from "module";

const require = createRequire(import.meta.url);

var Rsync = require('rsync');
var drivelist = require("drivelist");
const nodemailer = require("nodemailer");
var chmodr = require('chmodr');
var chownr = require('chownr');
var octal = require('octal');
var _ = require('underscore');

var exec = require('child_process').exec;
var fs = require('fs');

var mailSettings = require('./mailSettings.json');
var mailFrom = mailSettings.from;
var defaultEmail = mailSettings.defaultRecipient
var mailServer = mailSettings.server

var currentDrives = false;


var emailUpdateInterval = false;

//Check to see if we ran this with sudo, and fail out if not
checkSudo().then(function(isSudo){
    if(!isSudo){
        console.log('You must run this script with sudo');
        process.exit(1);
    }
    else{
        console.log('Monitoring script starting...');
    }
});




//First initialize our mail transport
let transporter = nodemailer.createTransport(mailServer);

async function logError(error, mailTo){
    console.log(error);
    //Then email the user
    if(!mailTo){
        mailTo = defaultEmail;
    }
    let info = await transporter.sendMail({
        from: mailFrom,
        to: mailTo,
        subject: "File Sync Error",
        text: "Your file sync encountered an error: "+error,
      });

      console.log('Error email sent');

}

function mountDrive(drive) {

    var devPath = drive.device;
    var escapedPath = devPath.replace(/\//g, '\\/');
    console.log('starting sync for ' + devPath);

    //First, find all partitions on the disk
    exec("sudo fdisk -l "+devPath+" | grep -P '"+escapedPath+"\\d' | awk '{print $1}'", function(err, stdout, stderr) {
        if (err) {
            logError('error listing disks: ' + err);
            return;
        }
        var partitions = stdout.split('\n').filter(function(part) {return part != ""});
        
        console.log('Available disk partitions: ', partitions);
        console.log('Mounting partitions one by one, and checking for presence of sync file');


        //Now mount drives one by one and check for our config file to see if we should sync
        //First we should see if the drive auto mounted
        if(drive.mountpoints.length > 0){
            var mountPoint = drive.mountpoints[0].path;
            console.log('Drive already mounted at: ' + mountPoint);
            syncDrive(mountPoint, drive);
        } else {
            for(var i in partitions){

                //Make a temp mount point for our drives
                const folderName = '/mnt/file-vacuum-'+i;
                try {
                    if (!fs.existsSync(folderName)) {
                        fs.mkdirSync(folderName)
                    }
                } catch (err) {
                    logError(err)
                }

                exec('sudo mount '+partitions[i]+' '+folderName, function(err, stdout, stderr){
                    if (err) {
                        logError('error mounting drive: ' + err);

                        //Remove the folder for the mount point
                        //fs.rmdirSync(folderName, { recursive: true });

                        return;
                    }

                    syncDrive(folderName, drive);
                    
                });
            }
        }

        //Finally, remove the folder for our mount point
        

    });
}


function syncDrive(mountPoint, drive){
    //Drive is mounted, list the files in it
    fs.readdir(mountPoint, function(err, files) {
        if (err) {
            logError('error listing files: ' + err);
            return;
        }
        //Check if we have our config file
        if (files.indexOf('sync.json') > -1) {
            console.log('Found sync.json, syncing...');
            //We have our config file, get data and set up sync
            fs.readFile(mountPoint+'/sync.json', async function(err, data) {
                if (err) {
                    logError('error reading sync.json: ' + err);
                    unmountDrive(mountPoint);
                    return;
                }
                var syncData = JSON.parse(data);
                console.log('Sync data: ', syncData);

                var mailTo = syncData.email;
                var syncPath = syncData.syncPath;
                var deleteAfter = syncData.deleteAfter;

                var owner = syncData.owner;
                var group = syncData.group;
                var permissions = syncData.permissions;

                if(!mailTo || !syncPath || !owner || !group || !permissions){
                    logError('Invalid sync data, aborting!');
                    unmountDrive(mountPoint);
                    return;
                }

                //Send an email to the user to let them know we are syncing
                let info = await transporter.sendMail({
                    from: mailFrom,
                    to: mailTo,
                    subject: "File Sync Starting",
                    text: "Your drive ("+drive.description+") is being synced to: "+syncPath,
                  });

                //Make sure our destination directory exists...
                if (!fs.existsSync(syncPath)){
                    fs.mkdirSync(syncPath);
                }

                //Set up an interval to email the user every half hour until we are done
                if(!emailUpdateInterval){
                    emailUpdateInterval = setInterval(function(){
                        console.log('Sending email update to let user know the sync is still running...');
                        transporter.sendMail({
                            from: mailFrom,
                            to: mailTo,
                            subject: "File Sync Status",
                            text: "Your drive ("+drive.description+") is still being actively synced to : "+syncPath+". Please be patient, this may take a while. If you do not receive an email for over 45 minutes and you have not received any errors or success notifications, please check on the sync manually.",
                          });
                    }, 1000 * 60 * 30);
                }

                //Now we have our data, set up the sync
                var rsync = new Rsync()
                    .flags('avz')
		            .set('progress')
                    .source(trailingSlashIt(mountPoint))
                    .destination(trailingSlashIt(syncPath))
                    .exclude('sync.json');

                rsync.output(
                    function(data){
                        process.stdout.write(data);
                    }, function(error){
                        process.stdout.write(error);
                    }
                );
                rsync.execute(async function(error, code, cmd) {
                    clearInterval(emailUpdateInterval);
                    if(error){
                        logError('error syncing: ' + error, mailTo);
                        unmountDrive(mountPoint, mailTo);
                        return;
                    }

                    //Check if we should delete after
                    if(deleteAfter){
                        //Recursively delete all files and folders
                        console.log('Deleting files after sync');
                        fs.readdir(mountPoint, function(err, files) {
                            if (err) {
                                logError('error listing files: ' + err, mailTo);
                                unmountDrive(mountPoint);
                                return;
                            }
                            for(var i in files){
                                var file = files[i];
                                if(file == 'sync.json'){
                                    continue;
                                }
                                console.log("deleting file: ", mountPoint+'/'+file);
                                fs.rmSync(mountPoint+'/'+file, { recursive: true, force: true });
                            }

                            correctPermissions(syncPath, owner, group, permissions).then(function(){
                                unmountDrive(mountPoint, mailTo).then(function(){
                                    sendSuccessEmail(drive, mailTo);
                                });
                            });
                            
                        });
                    }
                    else{
                        correctPermissions(syncPath, owner, group, permissions).then(function(){
                            unmountDrive(mountPoint).then(function(){
                                sendSuccessEmail(drive);
                            });
                        });
                    }
                    

                });
                    

            });

        }
        else{
            logError('Drive attached, but no sync.json found, skipping partition');
            unmountDrive(mountPoint);
        }
    });

}

function unmountDrive(mountPoint, mailTo){
    return new Promise(function(resolve, reject){
        //End by unmounting this drive...
        console.log('unmounting drive');
        exec('umount "'+mountPoint+'"', function(err, stdout, stderr){
            if(err){
                logError('error unmounting drive: ' + err, mailTo);
                reject(err);
                return;
            }
            console.log('drive unmounted successfully');
            fs.rmdirSync(mountPoint, { recursive: true });
            resolve();
        });
    });
}


async function sendSuccessEmail(drive, mailTo){
    //Sync completed successfully, lets send an email and unmount the drive
    console.log('Sync completed successfully!');
    console.log('Sending email...');

    if(!mailTo){
        mailTo = defaultEmail;
    }

    try{
        //Then email the user
        let info = await transporter.sendMail({
            from: mailFrom,
            to: mailTo,
            subject: "File Sync Complete",
            text: "Your file sync of "+drive.description+" has successfully completed! You may now unplug your drive",
          });

          console.log('Email sent!');
    }
    catch(err){
        logError(err);
    }
}


function correctPermissions(path, owner, group, permissions){
    return new Promise(function(resolve, reject){
        chownr(path, owner, group, function(err){
            if(err){
                logError('error changing file owner: ' + err);
                reject(err);
                return;
            }
            chmodr(path, octal(permissions), function(err){
                if(err){
                    logError('error changing permissions: ' + err);
                    reject(err);
                    return;
                }
                resolve();
            });
        });
    });
}







//Helper functions


function untrailingSlashIt(str) {
    return str.replace(/\/$/, '');
}

function trailingSlashIt(str) {
    return untrailingSlashIt(str) + '/';
}




  //Init our loop watcher

setInterval(async function(){
    var newDrives = await drivelist.list();
    if((newDrives.length > currentDrives.length) && currentDrives){
        var newDrive = _.filter(newDrives, function(obj){ return !_.findWhere(currentDrives, {devicePath: obj.devicePath}); })[0];

        // Now that we've found our drive path, let's trigger a sync
        mountDrive(newDrive);

        currentDrives = newDrives;
    }
    else if(!currentDrives || newDrives.length < currentDrives.length){
        //We've detached a drive, lets remove it from our list
        currentDrives = newDrives
    }
}, 5000);

