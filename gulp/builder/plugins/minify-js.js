/**
 * Плагин для минификации js.
 * JS с учётом паковки собственных зависимостей и минификации может быть представлен тремя или пятью файлами.
 * Simple.js без верстки в зависимостях:
 *   - Simple.js - оригинал
 *   - Simple.min.js - минифицированный файл по Simple.js
 *   - Simple.min.js.map - source map для Simple.min.js по Simple.js
 * Simple.js с версткой в зависимостях:
 *   - Simple.js - оригинал
 *   - Simple.modulepack.js - файл с пакованными зависимостями вёрстки
 *   - Simple.min.original.js - минифицированный файл по Simple.js. Для rt паковки.
 *   - Simple.min.js - минифицированный файл по Simple.modulepack.js
 *   - Simple.min.js.map - source map для Simple.min.js по Simple.modulepack.js
 *
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   esExt = /\.(es|ts)$/;

const excludeRegexes = [
   /.*\.min\.js$/,
   /.*\.routes\.js$/,
   /.*\.test\.js$/,

   // https://online.sbis.ru/opendoc.html?guid=05e7f1be-9fa9-48d4-a0d9-5506ac8d2b12
   /.*\.json\.js$/,
   /.*\.worker\.js$/,

   // TODO: удалить про node_modules
   /.*[/\\]node_modules[/\\]sbis3-dependency-graph[/\\].*/,
   /.*[/\\]ServerEvent[/\\]worker[/\\].*/,

   // https://online.sbis.ru/opendoc.html?guid=761eb095-c7be-437d-ab0c-c5058de852a4
   /.*[/\\]EDO2[/\\]Route[/\\].*/,

   // WS.Core/ext/requirejs/r.js используется только для юнит тестов и, возможно, в препроцессоре.
   // не нужно его минимизировать.
   // https://online.sbis.ru/opendoc.html?guid=02ee2490-afc0-4841-a084-b14aaca64e9c
   /.*[/\\]WS\.Core[/\\]ext[/\\]requirejs[/\\]r\.js/
];

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
            if (file.extname !== '.js') {
               callback(null, file);
               return;
            }

            for (const regex of excludeRegexes) {
               if (regex.test(file.path)) {
                  callback(null, file);
                  return;
               }
            }

            let outputFileWoExt;
            const extName = esExt.test(file.history[0]) ? esExt : file.extname;

            /**
             * объединённый словарь локализации пишется сразу же в кэш, поэтому для
             * него будет неправильно вычислен относительный путь. В данном случае нам просто
             * необходимо взять путь объединённого словаря и сделать .min расширение. Для всех
             * остальных css всё остаётся по старому. Также необходимо записать данные об исходном
             * объединённом словаре в кэш, чтобы при удалении/перемещении локализации объединённый
             * словарь был удалён из кэша за ненадобностью.
             */
            if (file.unitedDict) {
               outputFileWoExt = file.path.replace(extName, '');
               taskParameters.cache.addOutputFile(file.history[0], `${outputFileWoExt}.js`, moduleInfo);
            } else {
               const relativePathWoExt = path.relative(moduleInfo.path, file.history[0]).replace(extName, '');
               outputFileWoExt = path.join(moduleInfo.output, transliterate(relativePathWoExt));
            }
            const outputMinJsFile = `${outputFileWoExt}.min.js`;
            const outputMinOriginalJsFile = `${outputFileWoExt}.min.original.js`;
            const outputModulepackJsFile = `${outputFileWoExt}.modulepack.js`;

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputMinJsFile, moduleInfo);
               taskParameters.cache.addOutputFile(file.history[0], outputMinOriginalJsFile, moduleInfo);
               callback(null, file);
               return;
            }

            if (!file.modulepack) {
               // если файл не возможно минифицировать, то запишем оригинал
               let minText = file.contents.toString();
               const [error, minified] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.path,
                  minText,
                  false
               ]);
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error,
                     moduleInfo,
                     filePath: file.path
                  });
               } else {
                  minText = minified.code;
               }
               const newFile = file.clone();
               newFile.contents = Buffer.from(minText);
               newFile.base = moduleInfo.output;
               newFile.path = outputMinJsFile;
               this.push(newFile);
               taskParameters.cache.addOutputFile(file.history[0], outputMinJsFile, moduleInfo);
            } else {
               // минимизируем оригинальный JS
               // если файл не возможно минифицировать, то запишем оригинал
               let minOriginalText = file.contents.toString();
               const [errorOriginal, minifiedOriginal] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.path,
                  minOriginalText
               ]);
               if (errorOriginal) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error: errorOriginal,
                     moduleInfo,
                     filePath: file.path
                  });
               } else {
                  minOriginalText = minifiedOriginal.code;
               }

               // в случае библиотек в минифицированном виде нам всегда нужна только запакованная
               if (!file.library) {
                  this.push(
                     new Vinyl({
                        base: moduleInfo.output,
                        path: outputMinOriginalJsFile,
                        contents: Buffer.from(minOriginalText)
                     })
                  );
                  taskParameters.cache.addOutputFile(file.history[0], outputMinOriginalJsFile, moduleInfo);
               }

               // минимизируем JS c пакованными зависимостями
               // если файл не возможно минифицировать, то запишем оригинал
               let minText = file.modulepack;

               const [error, minified] = await execInPool(taskParameters.pool, 'minifyJs', [
                  file.path,
                  minText,
                  file.library
               ]);
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);
                  logger.error({
                     message: 'Ошибка минификации файла',
                     error,
                     moduleInfo,
                     filePath: outputModulepackJsFile
                  });
               } else {
                  minText = minified.code;
               }
               const newFile = file.clone();
               newFile.base = moduleInfo.output;
               newFile.path = outputMinJsFile;
               newFile.contents = Buffer.from(minText);
               this.push(newFile);
               if (file.versioned) {
                  taskParameters.cache.storeVersionedModule(file.history[0], moduleInfo.name, outputMinJsFile);
               }
               taskParameters.cache.addOutputFile(file.history[0], outputMinJsFile, moduleInfo);

               /**
                * В случае работы тестов нам нужно сохранить неминифицированный запакованный модуль,
                * поскольку это может быть библиотека, а для запакованной библиотеки важно проверить
                * запакованный контент. В минифицированном варианте могут поменяться имена переменнных и
                * тест проходить не будет.
                */
               if (taskParameters.config.rawConfig.builderTests) {
                  this.push(
                     new Vinyl({
                        base: moduleInfo.output,
                        path: outputModulepackJsFile,
                        contents: Buffer.from(file.modulepack)
                     })
                  );
                  taskParameters.cache.addOutputFile(file.history[0], outputModulepackJsFile, moduleInfo);
               }
            }
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
