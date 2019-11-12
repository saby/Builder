/**
 * Плагин для компиляции xml из *.xhtml файлов в js для release режима.
 * Создаёт новый файл *.min.xhtml.
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool');

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
            if (file.extname !== '.xhtml') {
               callback(null, file);
               return;
            }
            if (!taskParameters.config.templateBuilder) {
               logger.warning({
                  message: '"View" or "UI" module doesn\'t exists in current project. WS.Core "*.xhtml" templates will be ignored',
                  moduleInfo,
                  filePath: file.path
               });
               callback(null, file);
               return;
            }
            const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(/\.xhtml/, '.min.xhtml');
            const outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputMinFile, moduleInfo);
               callback(null, file);
               return;
            }

            // если xhtml не возможно скомпилировать, то запишем оригинал
            let newText = file.contents.toString();
            let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
            relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);

            const [errorBuild, resultBuild] = await execInPool(
               taskParameters.pool,
               'buildXhtml',
               [newText, relativeFilePath],
               relativeFilePath,
               moduleInfo
            );
            if (errorBuild) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  message: 'Ошибка компиляции XHTML',
                  errorBuild,
                  moduleInfo,
                  filePath: relativeFilePath
               });
            } else {
               /**
                * запишем в markupCache информацию о версионировании, поскольку
                * markupCache извлекаем при паковке собственных зависимостей. Так
                * можно легко обьединить, помечать компонент как версионированный или нет.
                */
               if (file.versioned) {
                  resultBuild.versioned = true;
               }
               if (file.cdnLinked) {
                  resultBuild.cdnLinked = true;
               }
               taskParameters.cache.storeBuildedMarkup(file.history[0], moduleInfo.name, resultBuild);
               newText = resultBuild.text;

               // если xhtml не возможно минифицировать, то запишем оригинал

               const [error, obj] = await execInPool(taskParameters.pool, 'minifyJs', [file.path, newText, true]);
               newText = obj.code;
               if (error) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);
                  logger.error({
                     message: 'Ошибка минификации скомпилированного XHTML',
                     error,
                     moduleInfo,
                     filePath: relativeFilePath.replace('.xhtml', '.min.xhtml')
                  });
               }
            }

            if (file.versioned) {
               taskParameters.cache.storeVersionedModule(file.history[0], moduleInfo.name, outputMinFile);
               file.versioned = false;
            }
            this.push(
               new Vinyl({
                  base: moduleInfo.output,
                  path: outputMinFile,
                  contents: Buffer.from(newText),
                  history: [...file.history]
               })
            );
            taskParameters.cache.addOutputFile(file.history[0], outputMinFile, moduleInfo);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: "Ошибка builder'а при компиляции XHTML",
               error,
               moduleInfo,
               filePath: file.path
            });
         }
         callback(null, file);
      }
   );
};
