/**
 * Detects all basic interfaces and theirs providers and packs them .
 * @author Kolbeshin F.A.
 */

'use strict';

const pMap = require('p-map');
const path = require('path');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();

module.exports = function generateTaskForInterfacePacking(taskParameters) {
   return async function packInterfaces() {
      const output = taskParameters.config.outputPath;
      const { interfaces, isReleaseMode } = taskParameters.config;
      await pMap(
         interfaces.required,
         async(currentInterface) => {
            const currentProviders = Object.keys(interfaces.provided).filter(
               currentKey => interfaces.provided[currentKey] === currentInterface
            ).sort((first, second) => {
               const firstIndex = interfaces.providedOrder.indexOf(first);
               const secondIndex = interfaces.providedOrder.indexOf(second);
               return firstIndex - secondIndex;
            });
            if (currentProviders.length > 0) {
               const lastProvider = currentProviders.pop();
               const callbackName = lastProvider.split('/').pop();

               // create an alias for provider in base interface module and return it as a result
               const aliasContent = `define("${currentInterface}",` +
                  `["require", "exports", "${lastProvider}"],` +
                  `function(require, exports, ${callbackName}) {` +
                  `Object.defineProperty(exports, "__esModule", { value: true });exports = ${callbackName}; });\n`;

               const providedContent = await fs.readFile(path.join(output, `${lastProvider}.js`), 'utf8');
               await fs.outputFile(path.join(output, `${currentInterface}.js`), aliasContent + providedContent);
               if (isReleaseMode) {
                  const providedMinifiedContent = await fs.readFile(path.join(output, `${lastProvider}.min.js`), 'utf8');
                  await fs.outputFile(path.join(output, `${currentInterface}.min.js`), aliasContent + providedMinifiedContent);
               }
            } else {
               const moduleInfo = taskParameters.config.modules.find(module => module.name === currentInterface.split('/').shift());
               logger.error({
                  message: `There is no available provider of base interface ${currentInterface} in current project`,
                  filePath: currentInterface,
                  moduleInfo
               });
            }
         },
         {
            concurrency: 50
         }
      );
   };
};
