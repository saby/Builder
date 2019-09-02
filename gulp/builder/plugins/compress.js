/**
 * Плагин архивации файлов с помощью gzip.
 * Генерирует в поток gzip файлы, но не пропускает через себя все остальные файлы, чтобы не перезаписывать лишинй раз.
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   execInPool = require('../../common/exec-in-pool'),
   { isWindows } = require('../../../lib/builder-constants');

const includeExts = ['.js', '.json', '.css', '.tmpl', '.wml', '.woff', '.ttf'];

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

            /**
             * in windows OS at the current moment brotli is not supported by
             * native libraries. iltorb requires in windows third-party dev-tools
             * for properly work. Support for windows will be added later with native
             * Node.Js brotli compiler - was added in Node.Js 11.7+, LTS-version will be
             * released in 22 october 2019.
             * TODO add windows support with native node.js brotli compiler as soon as LTS-version
             * of Node.js 12 will be released https://nodejs.org/en/about/releases/
             * Build brotli only with compatible version of Node.Js 10.14.2+.
             */
            const buildBrotli = !isWindows;
            const [error, result] = await execInPool(
               taskParameters.pool,
               'compress',
               [file.contents.toString(), buildBrotli],
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
               if (buildBrotli) {
                  file.path = `${file.path}.br`;
                  file.contents = Buffer.from(result.brotli);
                  this.push(file);
               }
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
