/**
 * Плагин для создания versioned_modules.json (список проверсионированных файлах)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   path = require('path'),
   helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate');

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         /**
          * для оставшихся модулей(минифицированные css, статические html) также
          * не забываем записать в кэш информацию
          */
         if (file.versioned && (file.basename.endsWith('.html') || file.basename.endsWith(`.min${file.extname}`))) {
            moduleInfo.cache.storeVersionedModule(
               file.history[0],
               transliterate(file.history[file.history.length - 1])
            );
         }
         callback(null, file);
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const versionedModules = [];
            const versionCache = moduleInfo.cache.getVersionedModulesCache(moduleInfo.name);
            const prettyCacheModulePath = helpers.prettifyPath(transliterate(moduleInfo.output));
            const prettyModulePath = helpers.prettifyPath(transliterate(moduleInfo.path));
            const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
            Object.keys(versionCache).forEach((currentModule) => {
               versionedModules.push(...versionCache[currentModule]);
            });
            const versionedModulesPaths = versionedModules.map((currentFile) => {
               const
                  prettyFilePath = transliterate(helpers.prettifyPath(currentFile)),
                  isSourcePath = prettyFilePath.includes(prettyModulePath),
                  relativePath = path.relative(isSourcePath ? prettyModulePath : prettyCacheModulePath, prettyFilePath);

               return helpers.unixifyPath(path.join(currentModuleName, relativePath));
            });

            if (taskParameters.config.contents) {
               console.log('ЗАПИСАЛИ в taskParameters.versionedModules информацию о модуле ' + currentModuleName);
               versionedModulesPaths.push(`${currentModuleName}/contents.json`);
            }

            const file = new Vinyl({
               path: '.builder/versioned_modules.json',
               contents: Buffer.from(JSON.stringify(versionedModulesPaths.sort())),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.addVersionedModules(currentModuleName, versionedModulesPaths);
            //taskParameters.addVersionedModules(currentModuleName, versionedModulesPaths);
            //taskParameters.addVersionedModules(currentModuleName, versionedModulesPaths);
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
