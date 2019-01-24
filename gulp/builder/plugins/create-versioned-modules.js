/**
 * Плагин для создания versioned_modules.json (список проверсионированных файлах)
 * @author Колбешин Ф.А.
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
   taskParameters.versionedModules = {};
   return through.obj(
      function onTransform(file, encoding, callback) {
         /**
          * для оставшихся модулей(минифицированные css, статические html) также
          * не забываем записать в кэш информацию
          */
         if (file.versioned && (file.basename.endsWith('.html') || file.basename.endsWith(`.min${file.extname}`))) {
            taskParameters.cache.storeVersionedModule(
               file.history[0],
               moduleInfo.name,
               transliterate(file.history[file.history.length - 1])
            );
         }
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         try {
            const versionedModules = [];
            const versionCache = taskParameters.cache.getVersionedModulesCache(moduleInfo.name);
            const prettyCacheModulePath = helpers.prettifyPath(transliterate(moduleInfo.output));
            const prettyModulePath = helpers.prettifyPath(transliterate(moduleInfo.path));
            const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
            Object.keys(versionCache).forEach((currentModule) => {
               versionedModules.push(...versionCache[currentModule]);
            });
            let versionedModulesPaths = versionedModules.map((currentFile) => {
               const
                  prettyFilePath = transliterate(helpers.prettifyPath(currentFile)),
                  isSourcePath = prettyFilePath.includes(prettyModulePath),
                  relativePath = path.relative(isSourcePath ? prettyModulePath : prettyCacheModulePath, prettyFilePath);

               return helpers.unixifyPath(path.join(currentModuleName, relativePath));
            });

            if (taskParameters.config.contents) {
               versionedModulesPaths.push(`${currentModuleName}/contents.json`);
            }

            /**
             * нужно удалить из versioned_modules таргеты Чистова, чтобы jinnee не пытался
             * читать файлы, которых не существует
             */
            if (!taskParameters.config.sources) {
               const projectName = taskParameters.config.rawConfig.cld_name;
               versionedModulesPaths = versionedModulesPaths.filter(
                  prettyPath => !helpers.needToRemoveModuleForDesktop(
                     prettyPath,
                     projectName === 'retail-offline' || projectName === 'presto-offline'
                  )
               );
            }

            const file = new Vinyl({
               path: '.builder/versioned_modules.json',
               contents: Buffer.from(JSON.stringify(versionedModulesPaths.sort(), null, 2)),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.versionedModules[currentModuleName] = versionedModulesPaths;
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
      }
   );
};
