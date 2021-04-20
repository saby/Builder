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
   const prettyCacheModulePath = helpers.unixifyPath(moduleInfo.output);
   const prettyModulePath = helpers.unixifyPath(moduleInfo.path);
   const currentModuleName = helpers.unixifyPath(moduleInfo.output).split('/').pop();
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         /**
          * для оставшихся модулей(минифицированные css, статические html) также
          * не забываем записать в кэш информацию
          */
         if (file.versioned && (file.basename.endsWith('.html') || file.basename.endsWith(`.min${file.extname}`))) {
            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);
            const prettyFilePath = helpers.unixifyPath(transliterate(file.history[file.history.length - 1]));
            const isSourcePath = prettyFilePath.includes(prettyModulePath);
            let relativeOutputPath = path.relative(
               isSourcePath ? prettyModulePath : prettyCacheModulePath,
               prettyFilePath
            );
            relativeOutputPath = helpers.unixifyPath(path.join(currentModuleName, relativeOutputPath));
            moduleInfo.cache.storeVersionedModule(relativeFilePath, relativeOutputPath);
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
            Object.keys(versionCache).forEach((currentModule) => {
               versionedModules.push(...versionCache[currentModule]);
            });

            if (taskParameters.config.contents) {
               versionedModules.push(`${currentModuleName}/contents.json`);

               // in desktop apps there will not be any contents.js files(debug files
               // removes from output in desktop apps). Write it in versioned_modules
               // for online projects only
               if (taskParameters.config.sources) {
                  versionedModules.push(`${currentModuleName}/contents.json.js`);
               }
               if (taskParameters.config.minimize) {
                  versionedModules.push(`${currentModuleName}/contents.min.json`);
                  versionedModules.push(`${currentModuleName}/contents.json.min.js`);
               }
            }

            const file = new Vinyl({
               path: '.builder/versioned_modules.json',
               contents: Buffer.from(JSON.stringify(versionedModules.sort())),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.setVersionedModules(currentModuleName, versionedModules);
         } catch (error) {
            logger.error({
               message: "Builder's error during versioned_modules meta generating",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
