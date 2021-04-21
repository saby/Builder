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
   const prettyCacheModulePath = helpers.unixifyPath(transliterate(moduleInfo.output));
   const prettyModulePath = helpers.unixifyPath(transliterate(moduleInfo.path));
   const currentModuleName = helpers.unixifyPath(moduleInfo.output).split('/').pop();
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
            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);
            const prettyFilePath = helpers.unixifyPath(transliterate(file.history[file.history.length - 1]));
            const isSourcePath = prettyFilePath.includes(prettyModulePath);
            let relativeOutputPath = path.relative(
               isSourcePath ? prettyModulePath : prettyCacheModulePath,
               prettyFilePath
            );
            relativeOutputPath = helpers.unixifyPath(path.join(currentModuleName, relativeOutputPath));
            moduleInfo.cache.storeCdnModule(relativeFilePath, relativeOutputPath);
         }
         callback(null, file);
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const cdnModules = [];
            const cdnCache = moduleInfo.cache.getCdnModulesCache();
            Object.keys(cdnCache).forEach((currentModule) => {
               cdnModules.push(...cdnCache[currentModule]);
            });

            const file = new Vinyl({
               path: '.builder/cdn_modules.json',
               contents: Buffer.from(JSON.stringify(cdnModules.sort())),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.setCdnModules(currentModuleName, cdnModules);
         } catch (error) {
            logger.error({
               message: "Builder's error during cdn_modules meta generating",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
