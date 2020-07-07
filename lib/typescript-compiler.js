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

async function runCompilerAndCheckForErrors(sourceDirectory, logFile, tscFlags = '--noEmit', branchTests = false) {
   const processOptions = {
      maxBuffer: 1024 * 500,
      cwd: sourceDirectory
   };

   // process.getegid is not available on windows or android, set it only for nix systems
   if (process.getegid) {
      processOptions.gid = process.getegid();
      processOptions.uid = process.geteuid();
   }

   /**
    * Prepare project directory for tsc command execute - copy typescript config
    * files from saby-typescript for proper "tsc" command execute. Get saby-typescript
    * workspace properly:
    * 1)saby-typescript as npm package of builder
    * 2)saby-typescript and builder has the same directory
    */
   let sabyTypescriptDirectory;
   if (await fs.pathExists(path.join(process.cwd(), '../saby-typescript'))) {
      sabyTypescriptDirectory = path.join(process.cwd(), '../saby-typescript');
   } else {
      sabyTypescriptDirectory = path.join(process.cwd(), 'node_modules/saby-typescript');
   }

   const tsConfigName = branchTests ? 'es5.test.json' : 'es5.json';

   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'configs', tsConfigName), path.join(sourceDirectory, 'tsconfig.json'));
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslib.js'), path.join(sourceDirectory, 'tslib.js'));
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslint/index.json'), path.join(sourceDirectory, 'tslint.json'));

   /**
    * symlink also node_modules from builder to current project.
    * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
    */
   await fs.ensureSymlink(path.join(process.cwd(), 'node_modules'), path.join(sourceDirectory, 'node_modules'));

   let result;

   /**
    * Add command for specifying additional memory for tsc compiler. Full online-inside
    * project(at the right moment) contains approximately  32737 typescript errors. To
    * log all this mess, tsc compiler uses more than default node js process memory(1.5 gb)
    */
   let heapSizeCommand;
   if (builderConstants.isWindows) {
      heapSizeCommand = 'set NODE_OPTIONS="--max-old-space-size=4096"';
   } else {
      heapSizeCommand = "export NODE_OPTIONS='--max-old-space-size=4096'";
   }
   await fs.outputFile(logFile, '');
   try {
      await exec(
         `${heapSizeCommand} && node ${sabyTypescriptDirectory}/cli.js --compiler ${tscFlags} >> "${logFile}"`,
         processOptions
      );
      logger.info('TypeScript compilation was completed successfully!');
      result = [];
   } catch (error) {
      result = await fs.readFile(logFile, 'utf8');
      result = result.split('\n').filter(currentError => !!currentError && !String(currentError).startsWith('  ') && String(currentError).includes('error TS'));
   }
   await clearWorkspaceFromTsConfig(sourceDirectory);
   return result.map(currentError => currentError.replace(/\r/g, ''));
}

async function clearWorkspaceFromTsConfig(sourceDirectory) {
   await fs.remove(path.join(sourceDirectory, 'tsconfig.json'));
   await fs.remove(path.join(sourceDirectory, 'tslib.js'));
   await fs.remove(path.join(sourceDirectory, 'tslint.json'));
   await fs.remove(path.join(sourceDirectory, 'node_modules'));
}

const CRITICAL_TS_ERRORS = [
   'TS1005',
   'TS1068',
   'TS1135',
   'TS1003',
   'TS1128'
];

async function typescriptCompiler(taskParameters, output, tscFlags) {
   const logFolder = taskParameters.config.logFolder || process.cwd();
   const logFile = path.join(logFolder, 'builder_compilation_errors.log');
   const sourceDirectory = path.join(taskParameters.config.cachePath, 'temp-modules');

   if (await fs.pathExists(logFile)) {
      await fs.remove(logFile);
   }

   const redirectOutputCommand = output ? `>> ${output}` : '';
   const tsErrors = await runCompilerAndCheckForErrors(
      sourceDirectory,
      redirectOutputCommand || logFile,
      tscFlags,
      taskParameters.config.branchTests
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
   }
}

module.exports = {
   runCompilerAndCheckForErrors,
   typescriptCompiler
};
