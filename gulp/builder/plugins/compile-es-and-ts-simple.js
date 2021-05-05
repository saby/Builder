/**
 * Плагин для компиляции ECMAScript 6+ и TypeScript в JavaScript (ES5).
 * Без учёта инкрементальной сборки. Нужно для подготовки WS для исполнения в билдере.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   { compileEsAndTs } = require('../../../lib/compile-es-and-ts');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         try {
            if (!file.contents) {
               callback();
               taskParameters.storePluginTime('typescript', startTime);
               return;
            }

            if (!['.es', '.ts'].includes(file.extname)) {
               callback(null, file);
               taskParameters.storePluginTime('typescript', startTime);
               return;
            }
            if (file.path.endsWith('.d.ts')) {
               callback(null, file);
               taskParameters.storePluginTime('typescript', startTime);
               return;
            }

            if (file.cached) {
               callback(null, file);
               taskParameters.storePluginTime('typescript', startTime);
               return;
            }
            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(moduleInfo.name, relativeFilePath);

            const jsInSources = file.history[0].replace('.ts', '.js');
            if (await fs.pathExists(jsInSources)) {
               const message =
                  `Существующий JS-файл мешает записи результата компиляции '${file.path}'.`;

               // выводим в режиме debug, т.к. это подготовительный этап сборки и никому не интересно особо
               logger.debug({
                  message,
                  filePath: jsInSources,
                  moduleInfo
               });
               callback(null, file);
               taskParameters.storePluginTime('typescript', startTime);
               return;
            }

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.relative
               );
               const compiledPath = path.join(compiledSourcePath.replace('.ts', '.js'));
               const compiledSourceHash = taskParameters.cache.getCompiledHash(moduleInfo, relativeFilePath);
               const currentHash = taskParameters.cache.getHash(moduleInfo, relativeFilePath);

               if (compiledSourceHash === currentHash) {
                  file.useSymlink = true;
                  const newFile = file.clone();
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  newFile.path = file.path.replace('.ts', '.js');
                  this.push(newFile);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.history[0]}. It has to be compiled, then.`);
            }

            const result = await compileEsAndTs(relativeFilePath, file.contents.toString(), moduleInfo.name);
            const newFile = file.clone();
            newFile.contents = Buffer.from(result.development.text);
            newFile.path = file.path.replace('.ts', '.js');
            this.push(newFile);
         } catch (error) {
            logger.error({
               message: 'Builder error for prepareWS typescript compilation',
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         callback(null, file);
         taskParameters.storePluginTime('typescript', startTime);
      }
   );
};
