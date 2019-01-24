/**
 * Плагин для создания cdn_modules.json (список файлов, в которых прописаны ссылки на cdn)
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
   taskParameters.cdnModules = {};
   return through.obj(
      function onTransform(file, encoding, callback) {
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
            taskParameters.cache.storeCdnModule(
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
            const cdnModules = [];
            const versionCache = taskParameters.cache.getCdnModulesCache(moduleInfo.name);
            const prettyCacheModulePath = helpers.prettifyPath(transliterate(moduleInfo.output));
            const prettyModulePath = helpers.prettifyPath(transliterate(moduleInfo.path));
            const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
            Object.keys(versionCache).forEach((currentModule) => {
               cdnModules.push(...versionCache[currentModule]);
            });
            let cdnModulesPaths = cdnModules.map((currentFile) => {
               const
                  prettyFilePath = transliterate(helpers.prettifyPath(currentFile)),
                  isSourcePath = prettyFilePath.includes(prettyModulePath),
                  relativePath = path.relative(isSourcePath ? prettyModulePath : prettyCacheModulePath, prettyFilePath);

               return helpers.unixifyPath(path.join(currentModuleName, relativePath));
            });

            /**
             * нужно удалить из cdn_modules таргеты Чистова, чтобы jinnee не пытался
             * читать файлы, которых не существует
             */
            if (!taskParameters.config.sources) {
               const projectName = taskParameters.config.rawConfig.cld_name;
               cdnModulesPaths = cdnModulesPaths.filter(
                  prettyPath => !helpers.needToRemoveModuleForDesktop(
                     prettyPath,
                     projectName === 'retail-offline' || projectName === 'presto-offline'
                  )
               );
            }

            const file = new Vinyl({
               path: '.builder/cdn_modules.json',
               contents: Buffer.from(JSON.stringify(cdnModulesPaths.sort(), null, 2)),
               moduleInfo
            });
            this.push(file);

            /**
             * оставляем версионированные модули, могут пригодиться в дальнейшем при паковке
             * @type {string[]}
             */
            taskParameters.cdnModules[currentModuleName] = cdnModulesPaths;
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
