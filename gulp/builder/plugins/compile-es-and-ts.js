/**
 * Плагин для компиляции ECMAScript 6+ и TypeScript в JavaScript (ES5).
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   fs = require('fs-extra'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   esExt = /\.(es|ts)$/,
   jsExt = /\.js$/;

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
         try {
            if (!file.contents) {
               callback();
               return;
            }

            if (!['.es', '.ts', '.js'].includes(file.extname)) {
               callback(null, file);
               return;
            }

            /**
             * Если имеется скомпилированный вариант для typescript или ES6 в исходниках, нам необходимо
             * выкинуть его из потока Gulp, чтобы не возникало ситуации, когда в потоке будут
             * 2 одинаковых модуля и билдер попытается создать 2 симлинка. Актуально также для релизной
             * сборки, когда скомпилированный для typescript модуль в исходниках может перебить скомпилированный
             * билдером typescript модуль.
             */
            if (file.extname === '.js') {
               const
                  esInSource = await fs.pathExists(file.path.replace(jsExt, '.es')),
                  tsInSource = await fs.pathExists(file.path.replace(jsExt, '.ts'));

               if (esInSource || tsInSource) {
                  callback(null);
               } else {
                  callback(null, file);
               }
               return;
            }
            if (file.path.endsWith('.d.ts')) {
               callback(null, file);
               return;
            }

            const relativePathWoExt = path.relative(moduleInfo.path, file.history[0]).replace(esExt, '');
            const outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
            const outputPath = `${outputFileWoExt}.js`;
            const outputMinJsFile = `${outputFileWoExt}.min.js`;
            const outputMinOriginalJsFile = `${outputFileWoExt}.min.original.js`;

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
               taskParameters.cache.addOutputFile(file.history[0], outputMinJsFile, moduleInfo);
               taskParameters.cache.addOutputFile(file.history[0], outputMinOriginalJsFile, moduleInfo);

               // modulepack is needed to check packed non-minified libraries for correctness in builder unit tests
               if (taskParameters.config.builderTests) {
                  const outputModulepackJsFile = `${outputFileWoExt}.modulepack.js`;
                  taskParameters.cache.addOutputFile(file.history[0], outputModulepackJsFile, moduleInfo);
               }
               callback(null, file);
               return;
            }
            if (taskParameters.config.staticServer) {
               file.pushToServer = true;
            }

            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(moduleInfo.name, relativeFilePath);

            const [error, result] = await execInPool(
               taskParameters.pool,
               'compileEsAndTs',
               [relativeFilePath, file.contents.toString(), moduleInfo.name],
               file.history[0],
               moduleInfo
            );
            if (error) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  error,
                  filePath: file.history[0],
                  moduleInfo
               });
               callback(null, file);
               return;
            }

            taskParameters.storePluginTime('typescript', result.passedTime, true);
            taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);

            /**
             * ts compiled cache is required only in libraries packer, that can be enabled with
             * builder flag "minimize"
             */
            if (taskParameters.config.minimize) {
               // алиас для совместимости с кэшем шаблонов при паковке библиотек.
               result.nodeName = result.moduleName;
               moduleInfo.cache.storeCompiledES(file.history[0], result);
            }
            const newFile = file.clone();
            newFile.contents = Buffer.from(result.text);
            newFile.compiled = true;
            newFile.path = outputPath;
            newFile.base = moduleInfo.output;
            this.push(newFile);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: "Ошибка builder'а при компиляции в JS",
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         callback(null, file);
      }
   );
};
