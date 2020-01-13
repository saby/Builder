/**
 * Плагин для версионирования в процессе инкрементальной сборки. В места, где должна быть версия, добавляет заглушку.
 * Связан с versionize-finish
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   {
      versionizeStyles,
      versionizeTemplates
   } = require('../../../lib/versionize-content');

const includeExts = ['.css', '.html', '.tmpl', '.xhtml', '.wml'];

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      const startTime = Date.now();
      try {
         if (!includeExts.includes(file.extname)) {
            callback(null, file);
            taskParameters.storePluginTime('versionize', startTime);
            return;
         }

         if (file.cached) {
            callback(null, file);
            taskParameters.storePluginTime('versionize', startTime);
            return;
         }

         let result;

         if (file.extname === '.css') {
            result = versionizeStyles(
               file,
               moduleInfo,
               {
                  multiService: taskParameters.config.multiService,
                  currentVersion: taskParameters.config.version
               }
            );
         } else if (['.html', '.tmpl', '.xhtml', '.wml'].includes(file.extname)) {
            result = versionizeTemplates(
               file,
               moduleInfo,
               {
                  multiService: taskParameters.config.multiService,
                  currentVersion: taskParameters.config.version
               }
            );
         }

         file.contents = Buffer.from(result.newText);
         if (result.errors) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.history[0]);
         logger.error({
            message: "Ошибка builder'а при версионировании",
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
      taskParameters.storePluginTime('versionize', startTime);
   });
};
