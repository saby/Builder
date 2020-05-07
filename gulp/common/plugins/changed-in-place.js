/**
 * Плагин, который маркирует флагом cached все входящие файлы.
 * cached == true, если файл не менялся между запусками сборки.
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger(),
   through = require('through2');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo = null) {
   return through.obj(async function onTransform(file, encoding, callback) {
      const startTime = Date.now();
      try {
         const isChanged = taskParameters.cache.isFileChanged(
            file.path,
            file.contents,
            taskParameters.config.hashByContent,
            file.stat.mtime.toString(),
            moduleInfo
         );
         if (isChanged instanceof Promise) {
            file.cached = !(await isChanged);
         } else {
            file.cached = !isChanged;
         }
      } catch (error) {
         logger.error({ error });
      }
      taskParameters.storePluginTime('changedInPlace', startTime);
      callback(null, file);
   });
};
