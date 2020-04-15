/**
 * Плагин архивации файлов с помощью gzip.
 * Генерирует в поток gzip файлы, но не пропускает через себя все остальные файлы, чтобы не перезаписывать лишинй раз.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool');

const includeExts = ['.js', '.json', '.css', '.tmpl', '.wml', '.ttf'];

const excludeRegexes = [
   /.*\.routes\.js$/,
   /.*\.test\.js$/,
   /[/\\]ServerEvent[/\\]worker[/\\].*/,
   /.*\.routes\.js$/,
   /.*\.original\.js$/,
   /.*\.modulepack\.js$/,
   /.*\.test\.js$/,
   /.*\.esp\.json$/,
   /.*[/\\]data-providers[/\\].*\.js$/,
   /.*[/\\]design[/\\].*\.js$/
];

/**
 * Объявление плагина
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!file.contents) {
               callback();
               return;
            }

            if (!includeExts.includes(file.extname)) {
               callback();
               return;
            }

            for (const regex of excludeRegexes) {
               if (regex.test(file.path)) {
                  callback();
                  return;
               }
            }

            const [error, result] = await execInPool(
               taskParameters.pool,
               'compress',
               [file.contents.toString()],
               file.path,
               moduleInfo
            );
            if (error) {
               logger.error({
                  message: 'Ошибка при архивации',
                  error,
                  moduleInfo,
                  filePath: file.path
               });
            } else {
               const newFile = file.clone();
               newFile.path = `${file.path}.gz`;
               newFile.contents = Buffer.from(result.gzip);
               this.push(newFile);
               file.path = `${file.path}.br`;
               file.contents = Buffer.from(result.brotli);
               this.push(file);
            }
         } catch (error) {
            logger.error({
               message: "Ошибка builder'а при архивации",
               error,
               moduleInfo,
               filePath: file.path
            });
         }
         callback();
      }
   );
};
