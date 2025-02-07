/**
 * Node-ibm_db Installer file.
 */

var fs = require('fs');
var url = require('url');
var os = require('os');
var path = require('path');
var exec = require('child_process').exec;
var execSync = require('child_process').execSync;
var axios = require('axios');

//IBM provided URL for downloading clidriver.
var installerURL = 'https://public.dhe.ibm.com/ibmdl/export/pub/software/data/db2/drivers/odbc_cli';
var license_agreement = '\n\n****************************************\nYou are downloading a package which includes the Node.js module for IBM DB2/Informix.  The module is licensed under the Apache License 2.0. The package also includes IBM ODBC and CLI Driver from IBM, which is automatically downloaded as the node module is installed on your system/device. The license agreement to the IBM ODBC and CLI Driver is available in '+DOWNLOAD_DIR+'   Check for additional dependencies, which may come with their own license agreement(s). Your use of the components of the package and dependencies constitutes your acceptance of their respective license agreements. If you do not accept the terms of any license agreement(s), then delete the relevant component(s) from your device.\n****************************************\n';

var CURRENT_DIR = process.cwd();
var DOWNLOAD_DIR = path.resolve(CURRENT_DIR, 'installer');
var INSTALLER_FILE; 
var deleteInstallerFile = false;
var platform = os.platform();
var arch = os.arch();

var vscode_build = false;
var electron_version = '12.0.4';

console.log("platform = ", platform, ", arch = ", arch, ", node.js version = ", process.version);

/* Show make version on non-windows platform, if installed. */
printMakeVersion();

/* Find electron version to use if ibm_db requires electron headers. */
findElectronVersion();

/*
 * "process.env.IBM_DB_INSTALLER_URL"
 * USE: to by-pass the IBM provided URL for downloading clidriver.
 * HOW: set environment variable with alternate downloading URL link.
 *      or locally downloaded "tar/zipped clidriver's" parent directory path.
 *      You can add IBM_DB_INSTALLER_URL in .npmrc file too.
 */
installerURL = process.env.npm_config_IBM_DB_INSTALLER_URL ||
               process.env.IBM_DB_INSTALLER_URL || installerURL;
installerURL = installerURL + "/";

//Function to download clidriver and install node-ibm_db
var install_node_ibm_db = function(file_url) {
    var readStream;
    var writeStream;
    var endian = os.endianness();
    var installerfileURL;

    var fstream = require('fstream');
    var unzipper = require('unzipper');

    var IBM_DB_HOME, IBM_DB_INCLUDE, IBM_DB_LIB, IBM_DB_DIR;

    /*
     * Installer steps: Generic for all platforms :
     * 1: Check IBM_DB_HOME path first, if present then install accordingly.
     * 2: If IBM_DB_HOME is not set, then download "clidriver" and then install.
     * 
     * Installer Steps: For windows only :
     * Step 1 and Step 2 are same.
     * There are two kinds of windows installation now:
     * 1: Auto Installation (Compilation and building - required Visual Studio).
     * 2: Pre-compiled Binary Installation.
     * 
     * If in any case "Auto Installation" fails, then the Installer will
     * automatically pick up the "Pre-compiled Binary Installation"" process. 
     * 
     */

    //If building for supporting VSCode Extn, then remove Clidriver folder and get it freshly
    if(vscode_build && fs.existsSync(path.join(DOWNLOAD_DIR,'clidriver'))){
        deleteFolderRecursive(path.join(DOWNLOAD_DIR,'clidriver'))
    }
    /*
     * IF: IBM_DB_HOME path is set ->
     * CASE 1: If "IBM_DB_HOME" environment variable path is set.
     * CASE 2: If "npm rebuild" and clidriver exists at DOWNLOAD_DIR location.
     * clidriver will not be download from remote location
     * node-ibm_db will use local clidriver package stored in-
     * IBM_DB_HOME path location.
     * ELSE: platform specific compressed clidriver package will be download
     * and then extract for further use.
     */
    if(process.env.IBM_DB_HOME || fs.existsSync(DOWNLOAD_DIR + "/clidriver")) 
    {
        var IS_ENVIRONMENT_VAR;
        if(process.env.IBM_DB_HOME){
            IBM_DB_HOME = process.env.IBM_DB_HOME;
            IS_ENVIRONMENT_VAR = true;
        }
        else if (fs.existsSync(DOWNLOAD_DIR + "/clidriver")){
            IBM_DB_HOME = path.resolve(DOWNLOAD_DIR, 'clidriver');
            process.env.IBM_DB_HOME = IBM_DB_HOME.replace(/\s/g,'\\ ');
            IS_ENVIRONMENT_VAR = false;
        }

        if (platform == 'os390') {
          // On z/OS, we need to extract the include header files from
          // SDSNC.H, and the sidedeck definition from SDSNMACS(DSNAO64C)
          var buildDir = CURRENT_DIR + '/build';
          if (!fs.existsSync(buildDir)) {
             fs.mkdirSync(buildDir, 0744);
          }
          var includeDir = buildDir + '/include';
          if (!fs.existsSync(includeDir)) {
             fs.mkdirSync(includeDir, 0744);
          }
          // Copy the header files from SDSNC.H
          execSync("cp \"//'" + IBM_DB_HOME + ".SDSNC.H'\" " + includeDir);

          // Add .h suffix to header files.
          var headers = fs.readdirSync(includeDir);
          for (var i in headers) {
            var pattern = /\.h$/i;
            var headerFile = includeDir + "/" + headers[i];
            if (!headerFile.match(pattern)) {
               fs.renameSync(headerFile, headerFile + ".h");
            }
          }

          // Copy the sidedeck definition to USS
          // Need to use TSO OPUT command to retain the FB80.
          execSync("tso \"oput '" + IBM_DB_HOME + ".SDSNMACS(DSNAO64C)' '" + buildDir + "/dsnao64c.x'\" | cat");
          // Build the binary
          buildBinary(!IS_ENVIRONMENT_VAR);
        } else {
                IBM_DB_INCLUDE = path.resolve(IBM_DB_HOME, 'include');
                if (fs.existsSync(IBM_DB_HOME + "/lib64")) {
                        IBM_DB_LIB = path.resolve(IBM_DB_HOME, 'lib64');
                } else if (fs.existsSync(IBM_DB_HOME + "/lib32")) {
                        IBM_DB_LIB = path.resolve(IBM_DB_HOME, 'lib32');
                } else {
                        IBM_DB_LIB = path.resolve(IBM_DB_HOME, 'lib');
                }

                if(IS_ENVIRONMENT_VAR){
                        console.log('IBM_DB_HOME environment variable have already been ' +
                                        'set to -> ' + IBM_DB_HOME +
                                        '\n\nDownloading of clidriver skipped - build is in progress...\n');
                }else{
                        console.log('Rebuild Process: Found clidriver at -> '+ IBM_DB_HOME +
                                        '\n\nDownloading of clidriver skipped - build is in progress...\n');
                }

                if (!fs.existsSync(IBM_DB_HOME)) {
                        console.log(IBM_DB_HOME + ' directory does not exist. Please check if you have ' + 
                                        'set the IBM_DB_HOME environment variable\'s value correctly.\n');
                }

                if(!(platform == 'win32' && IS_ENVIRONMENT_VAR == false)){
                        if (!fs.existsSync(IBM_DB_INCLUDE)) {
                                console.log(IBM_DB_INCLUDE + ' directory does not exist. Please check if you have ' + 
                                                'set the IBM_DB_HOME environment variable\'s value correctly.\n');
                        }
                }

                if (!fs.existsSync(IBM_DB_LIB)) {
                        console.log(IBM_DB_LIB + ' directory does not exist. Please check if you have ' + 
                                        'set the IBM_DB_HOME environment variable\'s value correctly.\n');
                }
                if( platform != 'win32') {
                        if(!fs.existsSync(IBM_DB_HOME + "/lib"))
                                fs.symlinkSync(IBM_DB_LIB, path.resolve(IBM_DB_HOME, 'lib'));

                        if((platform == 'linux') || (platform =='aix') ||
                                        (platform == 'darwin' && arch == 'x64')) {
                                removeWinBuildArchive();
                                buildBinary(!IS_ENVIRONMENT_VAR);
                        }
                }
                else if(platform == 'win32' && arch == 'x64') {
                        buildBinary(!IS_ENVIRONMENT_VAR);
                }
                else {
                        console.log('Building binaries for node-ibm_db. This platform ' +
                                        'is not completely supported, you might encounter errors. ' +
                                        'In such cases please open an issue on our repository, ' +
                                        'https://github.com/ibmdb/node-ibm_db. \n');
                }
        }
    }
    else
    {
        if(platform == 'win32') {
            if(arch == 'x64') {
                installerfileURL = installerURL + 'ntx64_odbc_cli.zip';
            }
        }
        else if(platform == 'linux') 
        {
            if(arch == 'x64') {
                installerfileURL = installerURL + 'linuxx64_odbc_cli.tar.gz';
            } else if(arch == 's390x') {
                installerfileURL = installerURL + 's390x64_odbc_cli.tar.gz';
            } else if(arch == 's390') {
                installerfileURL = installerURL + 's390_odbc_cli.tar.gz';
            } else if(arch == 'ppc64') {
                if(endian == 'LE')
                    installerfileURL = installerURL + 'ppc64le_odbc_cli.tar.gz';
                else
                    installerfileURL = installerURL + 'ppc64_odbc_cli.tar.gz';
            } else if(arch == 'ppc32') {
                installerfileURL = installerURL + 'ppc32_odbc_cli.tar.gz';
            } else {
                installerfileURL = installerURL + 'linuxia32_odbc_cli.tar.gz';
            }
        } 
        else if(platform == 'darwin') 
        {
            if(arch == 'x64') {
                installerfileURL = installerURL + 'macos64_odbc_cli.tar.gz';
            } else {
                console.log('Mac OS 32 bit not supported. Please use an ' +
                            'x64 architecture.\n');
                return;
            }
        } 
        else if(platform == 'aix')
        {
            if(arch == 'ppc')
            {
                installerfileURL = installerURL + 'aix32_odbc_cli.tar.gz';
            }
            else
            {
                installerfileURL = installerURL + 'aix64_odbc_cli.tar.gz';
            }
        }
        else if(platform == 'os390')
        {
            // zOS ODBC driver is part of Db2 installation.  Users need to
            // specify IBM_DB_HOME environment variable to the Db2 datasets
            // to allow the installer to access the necessary header files and
            // sidedeck definitions to build the node binding.
            console.log('Please set the environment variable IBM_DB_HOME to the ' + 
                        'High Level Qualifier (HLQ) of your Db2 libraries.\n');
            process.exit(1);
        }
        else
        {
            installerfileURL = installerURL + platform + arch + 
                               '_odbc_cli.tar.gz';
        }

        if(!installerfileURL) {
            console.log('Unable to fetch driver download file. Exiting the ' +
                        'install process.\n');
            process.exit(1);
        }

        var file_name = url.parse(installerfileURL).pathname.split('/').pop();
        INSTALLER_FILE = path.resolve(DOWNLOAD_DIR, file_name);

        console.log('Downloading DB2 ODBC CLI Driver from ' +
                    installerfileURL+'...\n');

        fs.stat(installerfileURL, function (err, stats) {
            if (!err && stats.isFile()) {
                INSTALLER_FILE = installerfileURL;
                return copyAndExtractCliDriver();
            }
            return downloadCliDriver(installerfileURL);
        });

    }  // * END OF EXECUTION */

    function copyAndExtractCliDriver() {
        if(platform == 'win32') {
            readStream = fs.createReadStream(INSTALLER_FILE);

            // Using the "unzipper" module to extract the zipped "clidriver",
            // and on successful close, printing the license_agreement
            var extractCLIDriver = readStream.pipe(unzipper.Extract({path: DOWNLOAD_DIR}));

            extractCLIDriver.on('close', function() {
                console.log(license_agreement);
                console.log('Downloading and extraction of DB2 ODBC ' +
                    'CLI Driver completed successfully... \n');

                IBM_DB_HOME = path.resolve(DOWNLOAD_DIR, 'clidriver');
                process.env.IBM_DB_HOME = IBM_DB_HOME.replace(/\s/g,'\\ ');
                buildBinary(true);
                if(deleteInstallerFile) removeInstallerFile();
            });

            extractCLIDriver.on('err', function() {
                console.log(err);
            });
        } 
        else 
        {
            var targz = require('targz');
            var compress = targz.decompress({src: INSTALLER_FILE, dest: DOWNLOAD_DIR}, function(err){
              if(err) {
                console.log(err);
                process.exit(1);
              }
              else {
                console.log(license_agreement);
                console.log('Downloading and extraction of DB2 ODBC ' +
                            'CLI Driver completed successfully ...\n');
                IBM_DB_HOME = path.resolve(DOWNLOAD_DIR, 'clidriver');
                process.env.IBM_DB_HOME = IBM_DB_HOME.replace(/\s/g,'\\ ');
                buildBinary(true);
                removeWinBuildArchive();
                if(deleteInstallerFile) removeInstallerFile();
              }
            });
        }
    }

    function buildBinary(isDownloaded) 
    {
        var buildString = "node-gyp configure build ";

        if(isDownloaded) {
            buildString = buildString + " --IS_DOWNLOADED=true";
        } else {
            buildString = buildString + " --IS_DOWNLOADED=false";
        }

        // Clean existing build directory
        if (platform != 'os390') {
            removeDir('build');
        }

        //Build triggered from the VSCode extension
        if(vscode_build){
            buildString = buildString + " --target=" + electron_version + " --arch=" + arch + " --dist-url=https://atom.io/download/electron";
        }

        // Windows : Auto Installation Process -> 1) node-gyp then 2) msbuild.
        if( platform == 'win32' && arch == 'x64')
        {
            var buildString = buildString + " --IBM_DB_HOME=\$IBM_DB_HOME";

            var childProcess = exec(buildString, function (error, stdout, stderr)
            {
                console.log(stdout);

                if (error !== null)
                {
                    // "node-gyp" FAILED: RUN Pre-compiled Binary Installation process.
                    console.log(error);
                    console.log('\nnode-gyp build process failed! \n\n' +
                    'Proceeding with Pre-compiled Binary Installation. \n');
                    installPreCompiledWinBinary();
                    return;
                }    

                else
                {
                    // "node-gyp" PASSED: RUN "msbuild" command.
                    var msbuildString = "msbuild /clp:Verbosity=minimal /nologo /p:Configuration=Release;Platform=x64 ";
                    if (fs.existsSync('build/Debug')) {
                        msbuildString = "msbuild /clp:Verbosity=minimal /nologo /p:Configuration=Debug;Platform=x64 ";
                    }

                    // getting the "binding.sln" (project solution) file path for "msbuild" command.
                    if (fs.existsSync(CURRENT_DIR + "/build/binding.sln"))
                    {
                        var BINDINGS_SLN_FILE = path.resolve(CURRENT_DIR, 'build/binding.sln');
                        msbuildString = msbuildString + '"' + BINDINGS_SLN_FILE + '"';
                    }
                    else
                    {
                        //If binding.sln file is missing then msbuild will fail.
                        console.log('\nbinding.sln file is not available! \n\n' +
                        'Proceeding with Pre-compiled Binary Installation. \n');
                        installPreCompiledWinBinary();
                        return;
                    }

                    /*
                     * EDITING: build/odbc_bindings.vcxproj file because,
                     * We need to remove "kernel" dependencies from the <AdditionalDependecy> tag.
                     * Otherwise "msbuild" command will produce corrupt binaries.
                     */
                    if (fs.existsSync(CURRENT_DIR + "/build/odbc_bindings.vcxproj"))
                    {
                        var ODBC_BINDINGS_VCXPROJ_FILE = path.resolve(CURRENT_DIR, 'build/odbc_bindings.vcxproj');
                        
                        fs.readFile(ODBC_BINDINGS_VCXPROJ_FILE, 'utf8', function (err,data) {
                            if (err)
                            {
                                console.log('\nReading failure: can not read ' +
                                'build/odbc_bindings.vcxproj! \n' +
                                'Proceeding with Pre-compiled Binary Installation.\n');
                                installPreCompiledWinBinary();
                                return;
                            }

                            //Removing kernel dependencies from the file.
                            var result = data.replace(/kernel32.lib;user32.lib;gdi32.lib;winspool.lib;comdlg32.lib;advapi32.lib;shell32.lib;ole32.lib;oleaut32.lib;uuid.lib;odbc32.lib;DelayImp.lib/g, '');
                            
                            fs.writeFile(ODBC_BINDINGS_VCXPROJ_FILE, result, 'utf8', function (err) {
                                if (err)
                                {
                                    console.log('\nWriting failure: can not write ' + 'build/odbc_bindings.vcxproj! \n' +
                                    'Proceeding with Pre-compiled Binary Installation. \n');
                                    installPreCompiledWinBinary();
                                    return;
                                }
                                else console.log("\nKernel additional dependencies removed successfully!\n");
                            });
                        });
                    }
                    else
                    {
                        /*
                         * IF: build/odbc_bindings.vcxproj file is missing,
                         * THEN: "msbuild" will produce corrupt binary (NO FAILURE), so to stop this:
                         * RUN: Pre-compiled Binary Installation process.
                         */
                        installPreCompiledWinBinary();
                        return;
                    }

                    removeDir('build/Release');
                    removeDir('build/Debug');

                    var childProcess = exec(msbuildString, function (error, stdout, stderr)
                    {
                        console.log(stdout);
                        if (error !== null)
                        {
                            // "msbuild" FAILED: RUN Pre-compiled Binary Installation process.
                            console.log(error);
                            console.log('\nmsbuild build process failed! \n\n' +
                            'Proceeding with Pre-compiled Binary Installation. \n');
                            installPreCompiledWinBinary();
                            return;
                        }
                        else
                        {
                            console.log("\nnode-ibm_db installed successfully!\n");
                        }
                    });
                }
            });
        }

        else
        {
            var buildString = buildString + " --IBM_DB_HOME=\"$IBM_DB_HOME\"";
            var childProcess = exec(buildString, function (error, stdout, stderr) {
                console.log(stdout);
                if (error !== null) {
                    console.log(error);
                    process.exit(1);
                }

                if(platform == 'darwin' && arch == 'x64') {
                    // Run the install_name_tool
                    var addonBinary = "./build/Release/odbc_bindings.node";
                    if (!fs.existsSync(addonBinary)) {
                      addonBinary = "./build/Debug/odbc_bindings.node";
                    }
                    var nameToolCommand = "install_name_tool -change libdb2.dylib \"$IBM_DB_HOME/lib/libdb2.dylib\" " + addonBinary;
                    if( isDownloaded ) // For issue #329
                    {
                      nameToolCommand = "install_name_tool -change libdb2.dylib @loader_path/../../installer/clidriver/lib/libdb2.dylib " + addonBinary;
                    }
                    var nameToolCmdProcess = exec(nameToolCommand , 
                    function (error1, stdout1, stderr1) {
                        if (error1 !== null) {
                            console.log('Error setting up the lib path to ' +
                            'odbc_bindings.node file.Error trace:\n'+error1);
                            process.exit(1);
                        }
                    });
                }
            });
        }
    } //buildBinary

    function removeWinBuildArchive() 
    {
        var WIN_BUILD_FILE = path.resolve(CURRENT_DIR, 'build.zip');
        fs.exists(WIN_BUILD_FILE, function(exists) 
        {
            if (exists) 
            {
                fs.unlinkSync(WIN_BUILD_FILE);
            }
        });
    }

    function removeInstallerFile()
    {
        // Delete downloaded odbc_cli.tar.gz file.
        fs.exists(INSTALLER_FILE, function(exists) 
        {
            if (exists) 
            {
                fs.unlinkSync(INSTALLER_FILE);
            }
        });
    }

    function installPreCompiledWinBinary()
    {
        if(platform == 'win32') {
            if(arch == 'x64') {
                var BUILD_FILE = path.resolve(CURRENT_DIR, 'build.zip');
                var odbcBindingsNode;
                var ODBC_BINDINGS = 'build\/Release\/odbc_bindings.node';

                if(vscode_build)
                {
                    odbcBindingsNode = 'build\/Release\/odbc_bindings_e' + electron_version + '.node';
                }
                else
                {
                    //Windows node binary names should update here.
                    var ODBC_BINDINGS_V8 = 'build\/Release\/odbc_bindings.node.8.17.0';
                    var ODBC_BINDINGS_V9 = 'build\/Release\/odbc_bindings.node.9.11.2';
                    var ODBC_BINDINGS_V10 = 'build\/Release\/odbc_bindings.node.10.24.0';
                    var ODBC_BINDINGS_V11 = 'build\/Release\/odbc_bindings.node.11.15.0';
                    var ODBC_BINDINGS_V12 = 'build\/Release\/odbc_bindings.node.12.20.1';
                    var ODBC_BINDINGS_V13 = 'build\/Release\/odbc_bindings.node.13.14.0';
                    var ODBC_BINDINGS_V14 = 'build\/Release\/odbc_bindings.node.14.17.1';
                    var ODBC_BINDINGS_V15 = 'build\/Release\/odbc_bindings.node.15.14.0';

                    // Windows add-on binary for node.js v0.10.x, v0.12.7, 4.x, 6.x and 7.x has been discontinued.
                    if(Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 8.0) {
                        console.log('\nERROR: Did not find precompiled add-on binary for node.js version ' + process.version + ':' +
                            '\nibm_db does not provide precompiled add-on binary for node.js version ' + process.version +
                    ' on Windows platform. Visual Studio is required to compile ibm_db with node.js versions < 8.X. ' +
                            'Otherwise please use the node.js version >= 8.X\n');
                        process.exit(1);
                    }

                    /*
                     * odbcBindingsNode will consist of the node binary-
                     * file name according to the node version in the system.
                     */
                    odbcBindingsNode = (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 9.0) && ODBC_BINDINGS_V8   ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 10.0) && ODBC_BINDINGS_V9   ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 11.0) && ODBC_BINDINGS_V10  ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 12.0) && ODBC_BINDINGS_V11 ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 13.0) && ODBC_BINDINGS_V12 ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 14.0) && ODBC_BINDINGS_V13 ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 15.0) && ODBC_BINDINGS_V14   ||
                                       (Number(process.version.match(/^v(\d+\.\d+)/)[1]) < 16.0) && ODBC_BINDINGS_V15 || ODBC_BINDINGS;
                }

                // Removing the "build" directory created by Auto Installation Process.
                // "unzipper" will create a fresh "build" directory for extraction of "build.zip".
                removeDir('build');
                readStream = fs.createReadStream(BUILD_FILE);
                /*
                 * unzipper will parse the build.zip file content and
                 * then it will check for the odbcBindingsNode
                 * (node Binary), when it gets that binary file,
                 * fstream.Writer will write the same node binary
                 * but the name will be odbc_bindings.node, and the other
                 * binary files and build.zip will be discarded.
                 */
                readStream.pipe(unzipper.Parse())
                    .on('entry', function (entry) {
                        if(entry.path === odbcBindingsNode) {
                            entry.pipe(fstream.Writer(ODBC_BINDINGS));
                        } else {
                            entry.autodrain();
                        }
                    })
                    .on('error', function(e) {
                        console.log('Installation Failed! \n',e);
                        process.exit(1);
                    })
                    .on('finish', function() {
                      console.log("\n" + 
                      "===================================\n"+
                      "node-ibm_db installed successfully!\n"+
                      "===================================\n");
                    });

                return 1;

            } else {
                console.log('Windows 32 bit not supported. Please use an ' +
                        'x64 architecture.\n');
                process.exit(1);
            }
        }
    }

    // Function to download clidriver file using axios module.
    function downloadCliDriver(installerfileURL) {
        // Variable to save downloading progress
        var received_bytes = 0;
        var total_bytes = 0;

        var outStream = fs.createWriteStream(INSTALLER_FILE);

        axios.get(installerfileURL, {responseType: 'stream'})
             .then(function (response) {
                total_bytes = parseInt(response.headers['content-length']);
                response.data.on('data', (chunk) => {
                    received_bytes += chunk.length;
                    showDownloadingProgress(received_bytes, total_bytes);
                });
                response.data.pipe(outStream);
              })
             .catch(error => {
                console.log(error)
              });

        deleteInstallerFile = true;
        outStream.once('close', copyAndExtractCliDriver)
        .once('error', function (err) {
            console.log(err);
        });
    }

    function showDownloadingProgress(received, total) {
        var percentage = ((received * 100) / total).toFixed(2);
        process.stdout.write((platform == 'win32') ? "\033[0G": "\r");
        process.stdout.write(percentage + "% | " + received + " bytes downloaded out of " + total + " bytes.");
    }

    function removeDir(dir) {
        var fullPath = path.resolve(CURRENT_DIR, dir);
        if (fs.existsSync(fullPath)) {
          if(platform == 'win32') {
            execSync( "rmdir /s /q " + '"' + fullPath + '"' );
          } else {
            execSync( "rm -rf " + '"' + fullPath + '"' );
          }
        }
    }

    function deleteFolderRecursive(p){
        if (fs.existsSync(p)) {
            fs.readdirSync(p).forEach(function(file, index){
                var curPath = path.join(p, file);
                if (fs.lstatSync(curPath).isDirectory()) { // recurse
                    deleteFolderRecursive(curPath);
                }else { // delete file
                    fs.unlinkSync(curPath);
                }
            });
            fs.rmdirSync(p);
        }
    }

}; //install_node_ibm_db

install_node_ibm_db();

function printMakeVersion() {
  if (platform != 'win32') {
    try {
      var makeVersion = execSync('make -v').toString();
      makeVersion = makeVersion.split('\n')[0];
      console.log("make version =", makeVersion);
    } catch (e) {
      console.log("Unable to find 'make' in PATH. Installation may fail!");
    }
  }
}

/* Detect electron version to compile ibm_db by checking version of installed
   electron package, or version of installed VSCode in the system.
 */
function findElectronVersion() {
  if ((process.env.npm_config_vscode) ||
     (__dirname.toLowerCase().indexOf('db2connect') != -1))
  {
    console.log('\nProceeding to build IBM_DB for Electron framework...\n');
    vscode_build = true;

    try {
        var npmOut = execSync('npm ls electron').toString();
        var electronVer = null;
        if (npmOut != null) {
          npmOut = npmOut.split('\n');
          for (var i = 0; i < npmOut.length; i++) {
            if (npmOut[i].indexOf('-- electron@') >= 0) {
              electronVer = npmOut[i].split('@')[1];
              break;
            }
          }
        }
    } catch (e) {
        console.log("Unable to detect electon installation.");
    }

    if (electronVer != null) {
        electron_version = electronVer;
        console.log("Detected electron installation, will use Electron",
                  "version", electron_version, "to install ibm_db.");
    } else {
        try {
          var codeOut = execSync('code --version').toString();
          vscodeVer = parseFloat(codeOut.split('\n')[0]);
          if(!isNaN(vscodeVer)) {
            if (vscodeVer >= 1.56){
                electron_version = "12.0.4";
            }
            else if (vscodeVer >= 1.53){
                electron_version = "11.2.1";
            }
            else if (vscodeVer >= 1.52) {
                electron_version = "9.3.5";
            }
            else if (vscodeVer >= 1.49) {
                electron_version = "9.2.1";
            }
            else if (vscodeVer >= 1.47) {
                electron_version = "7.3.2";
            }
            else if (vscodeVer >= 1.46) {
                electron_version = "7.3.1";
            }
            else if (vscodeVer >= 1.45) {
                electron_version = "7.2.4";
            }
            else {// vscode version older than 1.45 not supported
                electron_version = "7.1.11"; // old binary, not getting updated.
            }
            console.log("Detected VSCode version", vscodeVer,
                    ", will use Electron version ", electron_version);
          }
		  else {
            console.log("Unable to detect VSCode version,",
                    "will use Electron version ", electron_version);
          }
        }
        catch(e){
            console.log("Unable to find VSCode version,",
                    "will use Electron version ", electron_version);
        }
    }
    console.log("");
  }
}

