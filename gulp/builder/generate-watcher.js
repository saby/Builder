/**
 * API for native gulp watcher.
 */
'use strict';

const logger = require('../../lib/logger').logger();
const { exec } = require('child_process');
const { unixifyPath } = require('../../lib/helpers');
const path = require('path');
const ConfigurationReader = require('../common/configuration-reader');
const processParameters = ConfigurationReader.getProcessParameters(process.argv);
const fs = require('fs-extra');

/**
 * get processed and parsed gulp config to get proper
 * absolute path to builder cache and other useful information
 * @type {{}}
 */
const gulpConfig = ConfigurationReader.readConfigFileSync(processParameters.config, process.cwd());
const processOptions = {
   maxBuffer: 1024 * 500,
   cwd: process.cwd()
};
const isReleaseMode = ((config) => {
   const packingEnabled = config.deprecatedOwnDependencies || config.customPack || config.deprecatedStaticHtml;

   // if we are getting packing task as input, minimization should be enabled
   if (packingEnabled && !config.minimize) {
      config.minimize = true;
   }

   return config.minimize || packingEnabled ? 'release' : 'debug';
})(gulpConfig);

const SOURCE_ROOT = unixifyPath(`${gulpConfig.cache}/temp-modules`);
const CACHE_FOLDER = unixifyPath(`${gulpConfig.cache}/incremental_build`);
const OUTPUT_FOLDER = unixifyPath(gulpConfig.output);

/**
 * constants that describes Gulp native error about not existing file with
 * a given glob-pattern of a file that was transmitted by the Gulp-watcher
 * @type {string}
 */
const REMOVED_FILE_ERROR = 'File not found with singular glob:';
const REMOVED_FILE_SUGGESTION = '(if this was purposeful, use `allowEmpty` option)';

/**
 * main class for watcher function -
 * what and how to execute when there is a file to rebuild
 */
class WatcherTask {
   constructor() {
      this.errors = [];
      this.warnings = [];
      this.filesToRemove = [];
      this.hasErrors = false;
      this.hasWarnings = false;
      this.childProcess = null;
   }

   /**
    * catch all of output from process to log everything that is happening
    * inside of child_process(executes gulp task to rebuild single file)
    */
   processOutputEmit() {
      this.childProcess.stdout.on('data', (data) => {
         const dataString = data.toString();
         logger.debug(data.toString());
         if (dataString.includes('[ERROR]')) {
            this.errors.push(dataString);
            this.hasErrors = true;
         }
         if (dataString.includes('[WARNING]')) {
            this.warnings.push(dataString);
            this.hasWarnings = true;
         }
      });
   }

   // adds all paths for the given path with the given extensions to be replaced with
   addCompiledSource(filePath, from, to) {
      this.filesToRemove.push(to ? filePath.replace(from, to) : filePath);
      if (isReleaseMode) {
         const minifiedPath = filePath.replace(from, `.min${to || from}`);
         this.filesToRemove.push(minifiedPath);
         if (gulpConfig.compress) {
            this.filesToRemove.push(`${minifiedPath}.br`);
            this.filesToRemove.push(`${minifiedPath}.gz`);
         }
      }
   }

   // adds all paths that are belonging to the source path
   addPathsByExtension(filePath, extension) {
      this.filesToRemove.push(filePath);
      switch (extension) {
         case 'less':
            this.addCompiledSource(filePath, '.less', '.css');
            break;
         case 'ts':
            this.addCompiledSource(filePath, '.ts', '.js');
            break;
         default:
            this.addCompiledSource(filePath, extension);
            break;
      }
   }

   /**
    * Gets full path from error and adds whole list of files belonging to the source file
    * in depend of gulp configuration(minimization, compression, etc.)
    * @param data
    */
   addFilesToRemove(data) {
      const startFilePath = data.indexOf(REMOVED_FILE_ERROR) + REMOVED_FILE_ERROR.length;
      const endFilePath = data.indexOf(REMOVED_FILE_SUGGESTION);
      const filePath = data.slice(startFilePath, endFilePath).trim();
      const prettyPath = unixifyPath(filePath);
      const relativePath = prettyPath.replace(SOURCE_ROOT, '');
      const extension = relativePath.split('.').pop();

      this.addPathsByExtension(
         unixifyPath(path.join(OUTPUT_FOLDER, relativePath)),
         extension
      );
      if (isReleaseMode) {
         this.addPathsByExtension(
            unixifyPath(path.join(CACHE_FOLDER, relativePath)),
            extension
         );
      }
   }

   /**
    * catch all of critical errors from process that occurs inside
    * of a child_process(executes gulp task to rebuild single file)
    */
   processErrorEmit() {
      this.childProcess.stderr.on('data', (data) => {
         if (data.includes(REMOVED_FILE_ERROR)) {
            this.addFilesToRemove(data);
            logger.debug("source wasn't found because it was moved or renamed which means it has to be removed from output!");
            this.filesToRemove.forEach((currentPath) => {
               fs.removeSync(currentPath);
               logger.debug(`removed path ${currentPath}`);
            });
         } else {
            logger.debug(data.toString());
         }
      });
   }

   /**
    * Post processing results of single file gulp task execution.
    * Logs all errors/warning if it's occurred
    * @param resolve
    * @param reject
    */
   processResult(resolve, reject) {
      this.childProcess.on('exit', (code, signal) => {
         if (signal === 'SIGTERM') {
            logger.info('watcher has been terminated');
            reject();
         } else {
            if (this.hasErrors) {
               logger.info(`watcher: build was completed with these errors:\n${this.errors.join('\n')}`);
            }
            if (this.hasWarnings) {
               logger.info(`watcher: build was completed with these warnings:\n${this.errors.join('\n')}`);
            }
            if (!this.hasErrors) {
               logger.info(`watcher: file ${this.filePath} has been built successfully!`);
            }
            resolve();
         }
      });
   }

   // run single file gulp task for current file
   execute(filePath) {
      this.filePath = filePath;
      this.reset();
      logger.info(`watcher: start file ${filePath} build!`);
      const gulpBinPath = require.resolve('gulp/bin/gulp');
      this.childProcess = exec(
         `node ${gulpBinPath} buildOnChange --config="${processParameters.config}" --nativeWatcher=true --filePath="${this.filePath}"`,
         processOptions
      );
      this.processOutputEmit();
      this.processErrorEmit();

      return new Promise((resolve, reject) => {
         this.processResult(resolve, reject);
      });
   }

   /**
    * reset common watcher params list each time the watcher is triggering
    */
   reset() {
      this.errors = [];
      this.warnings = [];
      this.filesToRemove = [];
      this.hasErrors = false;
      this.hasWarnings = false;
   }
}

module.exports = {
   WatcherTask,
   SOURCE_ROOT
};
