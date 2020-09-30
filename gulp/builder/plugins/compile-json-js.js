/**
 * Плагин для компиляции json-файлов в AMD-формат.
 * json-файлы необходимо вставлять в разметку как скрипты, чтобы
 * разрешить проблему, которую описал Бегунов Андрей:
 * Cсылку на json нельзя вставить в тело страницы. В итоге оживление
 * идет с синхронными разрывами через require.js.
 * Также в будущем возникнет ситуация, что json плагина нет в es6 modules
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   fs = require('fs-extra'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   compileJsonToJs = require('../../../lib/compile-json-to-js'),
   jsonExt = /\.json\.js$/;

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
               taskParameters.storePluginTime('jsonJs', startTime);
               return;
            }

            /**
             * dont build AMD-formatted json files for *.package.json and *.config.json. It's common
             * builder config files, participating only in project's build.
             */
            if (!file.basename.includes('.json') || file.basename.includes('package.json') || file.basename.endsWith('.config.json')) {
               callback(null, file);
               taskParameters.storePluginTime('jsonJs', startTime);
               return;
            }

            /**
             * Remove AMD-formatted json sources from stream if json source file
             * exists. It will be compiled into AMD-formatted json file.
             * Needed to avoid double symlink issue in debug build(double symlinks
             * throws fatal error).
             * P.S. can't be catched by tests, file order in gulp stream can be different between 2 builds.
             * It can throw an error in first build, and build successfully in another
             */
            if (file.basename.endsWith('.json.js')) {
               const jsonInSource = await fs.pathExists(file.path.replace(jsonExt, '.json'));

               if (jsonInSource) {
                  callback(null);
               } else {
                  callback(null, file);
               }
               taskParameters.storePluginTime('jsonJs', startTime);
               return;
            }

            const currentFileBase = file.history[0].startsWith(moduleInfo.path) ? moduleInfo.path : moduleInfo.output;
            const relativePath = path.relative(currentFileBase, file.history[0]).replace(/\.(json)$/, '.json.js');
            const outputPath = path.join(moduleInfo.output, transliterate(relativePath));
            const outputMinPath = outputPath.replace(/\.js$/, '.min.js');

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
               taskParameters.cache.addOutputFile(file.history[0], outputMinPath, moduleInfo);
               callback(null, file);
               taskParameters.storePluginTime('jsonJs', startTime);
               return;
            }

            let
               relativeFilePath = path.relative(currentFileBase, file.history[0]),
               result;

            relativeFilePath = path.join(path.basename(currentFileBase), relativeFilePath);

            try {
               result = compileJsonToJs(relativeFilePath, file.contents.toString());
            } catch (error) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  message: 'Ошибка создания AMD-модуля для json-файла',
                  error,
                  filePath: file.history[0],
                  moduleInfo
               });
               callback(null, file);
               taskParameters.storePluginTime('jsonJs', startTime);
               return;
            }

            taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
            const newFile = file.clone();
            newFile.contents = Buffer.from(result);
            newFile.path = outputPath;
            newFile.base = moduleInfo.output;
            this.push(newFile);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: "Ошибка builder'а при компиляции json в JS",
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         taskParameters.storePluginTime('jsonJs', startTime);
         callback(null, file);
      }
   );
};
