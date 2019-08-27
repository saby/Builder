'use strict';

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger').logger();

async function runCompilerAndCheckForErrors(sourceDirectory) {
   /**
    * Because of "npx tsc" command runs from internal builder tests directory without own node_modules
    * npx tries to use typescript from npm root instead of installed in builder node_modules
    */
   process.env.PATH = `${process.cwd()}/node_modules/typescript/bin:${process.env.PATH}`;
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
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'configs/es5.json'), path.join(sourceDirectory, 'tsconfig.json'));
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslib.js'), path.join(sourceDirectory, 'tslib.js'));
   await fs.ensureSymlink(path.join(sabyTypescriptDirectory, 'tslint/index.json'), path.join(sourceDirectory, 'tslint.json'));

   let result;
   try {
      await exec('tsc --noEmit', processOptions);
      logger.info('tsc command for current project was completed successfully!');
      result = [];
   } catch (error) {
      result = error.stdout.split('\n').filter(currentError => !!currentError);
   }
   await clearWorkspaceFromTsConfig(sourceDirectory);
   return result.map(currentError => currentError.replace(/\r/g, ''));
}

async function clearWorkspaceFromTsConfig(sourceDirectory) {
   await fs.remove(path.join(sourceDirectory, 'tsconfig.json'));
   await fs.remove(path.join(sourceDirectory, 'tslib.js'));
   await fs.remove(path.join(sourceDirectory, 'tslint.json'));
}

async function typescriptCompiler(taskParameters) {
   const sourceDirectory = path.join(taskParameters.config.cachePath, 'temp-modules');
   const tsErrors = await runCompilerAndCheckForErrors(sourceDirectory);
   if (tsErrors.length > 0) {
      tsErrors.forEach((currentError) => {
         const moduleInfo = taskParameters.config.modules.find(
            currentModule => currentModule.name === currentError.split('/').shift()
         );
         logger.info({
            message: currentError,
            moduleInfo
         });
      });
      logger.info('tsc command for current project was completed with errors. Check logs');
   }
}

module.exports = {
   runCompilerAndCheckForErrors,
   typescriptCompiler
};
