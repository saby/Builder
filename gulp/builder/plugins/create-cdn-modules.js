/**
 * Плагин для создания cdn_modules.json (список файлов, в которых прописаны ссылки на cdn)
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
          * не забываем записать в кэш информацию. В случае сборки в десктопе в
          * cdn_modules.json нельзя записывать дебажные шаблоны и css, поскольку они
          * удаляются в конце работы билдера. В случае сборки онлайн-проекта можно
          * записывать все файлы.
          */
         let cdnCondition;
         if (taskParameters.config.sources) {
            cdnCondition = file.cdnLinked;
         } else {
            cdnCondition = file.cdnLinked &&
               (file.basename.endsWith('.html') || file.basename.endsWith(`.min${file.extname}`));
         }
         if (cdnCondition) {
            moduleInfo.cache.storeCdnModule(
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
            const cdnModules = [];
            const versionCache = moduleInfo.cache.getCdnModulesCache();
            const prettyCacheModulePath = helpers.prettifyPath(transliterate(moduleInfo.output));
            const prettyModulePath = helpers.prettifyPath(transliterate(moduleInfo.path));
            const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
            Object.keys(versionCache).forEach((currentModule) => {
               cdnModules.push(...versionCache[currentModule]);
            });
            const cdnModulesPaths = cdnModules.map((currentFile) => {
               const
                  prettyFilePath = transliterate(helpers.prettifyPath(currentFile)),
                  isSourcePath = prettyFilePath.includes(prettyModulePath),
                  relativePath = path.relative(isSourcePath ? prettyModulePath : prettyCacheModulePath, prettyFilePath);

               return helpers.unixifyPath(path.join(currentModuleName, relativePath));
            });

            const file = new Vinyl({
               path: '.builder/cdn_modules.json',
               contents: Buffer.from(JSON.stringify(cdnModulesPaths.sort())),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.setCdnModules(currentModuleName, cdnModulesPaths);
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
