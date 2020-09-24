/**
 * Плагин для минификации css
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool');

const { stylesToExcludeFromMinify } = require('../../../lib/builder-constants');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            // Нужно вызвать taskParameters.cache.addOutputFile для less, чтобы не удалился *.min.css файл.
            // Ведь самой css не будет в потоке при повторном запуске
            if (!['.css', '.less'].includes(file.extname)) {
               callback(null, file);
               return;
            }

            for (const regex of stylesToExcludeFromMinify) {
               if (regex.test(file.path)) {
                  callback(null, file);
                  return;
               }
            }

            let outputMinFile;

            /**
             * объединённый словарь локализации пишется сразу же в кэш, поэтому для
             * него будет неправильно вычислен относительный путь. В данном случае нам просто
             * необходимо взять путь объединённого словаря и сделать .min расширение. Для всех
             * остальных css всё остаётся по старому.
             */
            if (file.unitedDict) {
               outputMinFile = file.path.replace(/\.css$/, '.min.css');
            } else {
               const lastHistory = file.history[file.history.length - 1];
               const filePath = /\.css$/.test(file.history[0]) ? moduleInfo.path : moduleInfo.output;
               const relativePath = path.relative(filePath, lastHistory).replace(/\.css$/, '.min.css');
               outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));
            }
            if (file.cached) {
               taskParameters.cache.getOutputForFile(file.history[0]).forEach((outputFile) => {
                  taskParameters.cache.addOutputFile(file.history[0], outputFile.replace(/\.css$/, '.min.css'), moduleInfo);
               });
               callback(null, file);
               return;
            }

            // Минифицировать less не нужно
            if (file.extname !== '.css') {
               callback(null, file);
               return;
            }

            // если файл не возможно минифицировать, то запишем оригинал
            let newText = file.contents.toString();

            const [error, minified] = await execInPool(taskParameters.pool, 'minifyCss', [newText]);
            taskParameters.storePluginTime('minify css', minified.passedTime, true);
            newText = minified.styles;
            if (minified.errors.length > 0) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               const errors = minified.errors.toString();
               logger.warning({
                  message: `Ошибки минификации файла: ${errors.split('; ')}`,
                  moduleInfo,
                  filePath: file.path
               });
            }
            if (error) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  message: 'Ошибка минификации файла',
                  error,
                  moduleInfo,
                  filePath: file.path
               });
            }

            const newFile = file.clone();
            newFile.contents = Buffer.from(newText);
            newFile.path = outputMinFile;
            newFile.base = moduleInfo.output;
            this.push(newFile);
            taskParameters.cache.addOutputFile(file.history[0], outputMinFile, moduleInfo);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: "Ошибка builder'а при минификации",
               error,
               moduleInfo,
               filePath: file.path
            });
         }
         callback(null, file);
      }
   );
};
