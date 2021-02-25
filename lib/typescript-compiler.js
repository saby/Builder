/**
 * The common library for searching of errors in typescript-compiler inside the current project
 * through the usage of command "tsc --noEmit".
 * Using by common "Gulp" task - "build".
 * builder/gulp/builder/generate-workflow.js
 * @author Kolbeshin F.A.
 */

'use strict';

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger').logger();
const { formatEntry } = require('./logger');
const CRITICAL_ERRORS = require('./typescript-critical-errors.json');
const TRUSTED_ERRORS = require('./typescript-trusted-errors.json');
const builderConstants = require('./builder-constants');

async function createCommonTsSymlinks(sourceDirectory, tsConfigName, createNodeModulesSymlink) {
   /**
    * Prepare project directory for tsc command execute - copy typescript config
    * files from saby-typescript for proper "tsc" command execute. Get saby-typescript
    * workspace properly:
    * 1)saby-typescript as npm package of builder
    * 2)saby-typescript and builder has the same directory
    * By this reckon also node_modules directory must be properly chosen
    */
   let sabyTypescriptDirectory;
   if (await fs.pathExists(path.join(process.cwd(), '../saby-typescript'))) {
      sabyTypescriptDirectory = path.join(process.cwd(), '../saby-typescript');
   } else {
      sabyTypescriptDirectory = path.join(process.cwd(), 'node_modules/saby-typescript');
   }

   if (tsConfigName) {
      await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'configs', tsConfigName), path.join(sourceDirectory, 'tsconfig.json'));
   }
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslib.js'), path.join(sourceDirectory, 'tslib.js'));
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslint/index.json'), path.join(sourceDirectory, 'tslint.json'));

   if (createNodeModulesSymlink) {
      /**
       * symlink also node_modules from builder to current project.
       * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
       */
      await fs.ensureSymlink(path.dirname(sabyTypescriptDirectory), path.join(sourceDirectory, 'node_modules'));
   }
   return sabyTypescriptDirectory;
}

async function runCompilerAndCheckForErrors(
   sourceDirectory,
   tscFlags,
   logFile,
   tsConfigName
) {
   const processOptions = {
      maxBuffer: 1024 * 500,
      cwd: sourceDirectory
   };

   // process.getegid is not available on windows or android, set it only for nix systems
   if (process.getegid) {
      processOptions.gid = process.getegid();
      processOptions.uid = process.geteuid();
   }

   // create node_modules symlink if there is tsconfigName transmitted through
   const sabyTypescriptDirectory = await createCommonTsSymlinks(sourceDirectory, tsConfigName, tsConfigName);

   let result;

   /**
    * Add command for specifying additional memory for tsc compiler. Full online-inside
    * project(at the right moment) contains approximately  32737 typescript errors. To
    * log all this mess, tsc compiler uses more than default node js process memory(1.5 gb)
    */
   let heapSizeCommand;
   if (builderConstants.isWindows) {
      heapSizeCommand = 'set NODE_OPTIONS="--max-old-space-size=8192"';
   } else {
      heapSizeCommand = "export NODE_OPTIONS='--max-old-space-size=8192'";
   }
   await fs.outputFile(logFile, '');
   try {
      await exec(
         `${heapSizeCommand} && node "${sabyTypescriptDirectory}/cli.js" --compiler ${tscFlags} >> "${logFile}"`,
         processOptions
      );
      result = [];
   } catch (error) {
      result = await fs.readFile(logFile, 'utf8');
      result = result.split('\n').filter(currentError => !!currentError && !String(currentError).startsWith('  ') && String(currentError).includes('error TS'));
   }
   return result.map(currentError => currentError.replace(/\r/g, ''));
}

async function clearWorkspaceFromTsConfig(sourceDirectory, removeTsConfig) {
   if (removeTsConfig) {
      await fs.remove(path.join(sourceDirectory, 'tsconfig.json'));
   }
   await fs.remove(path.join(sourceDirectory, 'tslib.js'));
   await fs.remove(path.join(sourceDirectory, 'tslint.json'));
   await fs.remove(path.join(sourceDirectory, 'node_modules'));
}

const CRITICAL_TS_ERRORS = [
   'TS1005',
   'TS1068',
   'TS1135',
   'TS1136',
   'TS1002',
   'TS1003',
   'TS1128',
   'TS1144'
];

/**
 * strict version of tsc compilation. This function emits all errors
 * that will be found without any exclusion
 * @returns {Promise<void>}
 */
async function strictTypescriptCompiler(taskParameters, moduleName, currentTsConfigPath) {
   const logFolder = taskParameters.config.logFolder || process.cwd();
   const logFile = `${logFolder}/${moduleName}-typescript-errors.log`;
   const sourceDirectory = path.dirname(currentTsConfigPath);
   const COMMON_TSC_FLAGS = `--noEmit --p "${currentTsConfigPath}"`;

   if (await fs.pathExists(logFile)) {
      await fs.remove(logFile);
   }

   const tsErrors = await runCompilerAndCheckForErrors(sourceDirectory, COMMON_TSC_FLAGS, logFile);
   const logErrors = [];
   if (tsErrors.length > 0) {
      tsErrors.forEach((message) => {
         const normalizedMessage = message.replace(/^.+?temp-modules(\/|\\)/, '');
         const moduleInfo = taskParameters.config.modules.find(
            currentModule => currentModule.name === normalizedMessage.split('/').shift()
         );
         logger.error({ message: normalizedMessage, moduleInfo });
         logErrors.push(formatEntry({ message: normalizedMessage, moduleInfo }).message);
      });
      logger.error(`Strict TypeScript compilation for module ${moduleName} was completed with errors. Check log records above for details.`);

      await fs.outputFile(logFile, logErrors.join('\n'));
   } else {
      logger.info(`Strict TypeScript compilation for module ${moduleName} was completed successfully!`);
   }
}

/**
 * common tsc compilation for an entire project with its own
 * list of strict modules checks(Interface modules where each error
 * is critical, was cleaned out earlier), and list of exclusions - this list
 * is stored in typescript-trusted-errors.json.
 * @param{TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param{String} output - output path for log of all ts errors
 * @returns {function(): Promise<void>}
 */
function typescriptCompiler(taskParameters, output) {
   return async function checkTypescriptForProject() {
      const logFolder = taskParameters.config.logFolder || process.cwd();
      const logFile = path.join(logFolder, 'builder_compilation_errors.log');
      const sourceDirectory = path.join(taskParameters.config.cachePath, 'temp-modules');
      const COMMON_TSC_FLAGS = '--noEmit --incremental --tsBuildInfoFile "../front-end"';

      if (await fs.pathExists(logFile)) {
         await fs.remove(logFile);
      }

      const tsErrors = await runCompilerAndCheckForErrors(
         sourceDirectory,
         COMMON_TSC_FLAGS,
         output || logFile,
         taskParameters.config.tsconfig
      );
      if (tsErrors.length > 0) {
         const defaultLevel = taskParameters.config.isSbisPlugin ? 'debug' : 'info';
         let overallLevel = 'info';
         const logErrors = [];
         tsErrors.forEach((message) => {
            const moduleInfo = taskParameters.config.modules.find(
               currentModule => currentModule.name === message.split('/').shift()
            );

            logErrors.push(formatEntry({ message, moduleInfo }).message);

            /**
             * Don't log errors in Sbis Plugin because of issue with tsc configuration
             * TODO remove it after task completion
             * https://online.sbis.ru/opendoc.html?guid=77afe3f3-e22e-46ce-8355-6f73c135f2e9
             */
            let level = !taskParameters.config.isSbisPlugin &&
            CRITICAL_ERRORS.some(criticalMessage => message.startsWith(criticalMessage)) ? 'error' : defaultLevel;

            if (level === 'error') {
               level = TRUSTED_ERRORS.some(trustedMessage => message.startsWith(trustedMessage)) ? defaultLevel : 'error';
            }

            // Don't pass any critical syntax errors
            if (CRITICAL_TS_ERRORS.some(errorCode => message.includes(`error ${errorCode}:`))) {
               level = 'error';
            }

            if (level === 'error') {
               logger[level]({ message, moduleInfo });
               overallLevel = 'error';
            }
         });

         if (overallLevel === 'error') {
            logger[overallLevel]('TypeScript compilation was completed with errors. Check log records above for details.');
         } else {
            logger[defaultLevel](`TypeScript compilation was completed with errors. Check "${logFile}" for details.`);
         }

         await fs.outputFile(logFile, logErrors.join('\n'));
      } else {
         logger.info('TypeScript compilation was completed successfully!');
      }
   };
}

module.exports = {
   runCompilerAndCheckForErrors,
   strictTypescriptCompiler,
   typescriptCompiler,
   clearWorkspaceFromTsConfig
};
