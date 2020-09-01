/**
 * Плагин для фильтрации не изменённых файлов, чтобы не перезаписывать и не напрягать диск.
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger(),
   path = require('path'),
   through = require('through2');

/**
 * Объявление плагина
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      try {
         if (!file.hasOwnProperty('cached') || !file.cached) {
            if (file.pushToServer) {
               const outputFilePath = path.join(
                  path.basename(moduleInfo.output),
                  file.relative
               ).replace(/\\/g, '/');
               taskParameters.addChangedFile(outputFilePath);
            }
            callback(null, file);
            return;
         }
      } catch (error) {
         logger.error({ error });
      }
      callback();
   });
};
