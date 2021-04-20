/**
 * Плагин для компиляции xml из *.xhtml файлов в js для release режима.
 * Создаёт новый файл *.min.xhtml.
 * @author Kolbeshin F.A.
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
   const moduleName = path.basename(moduleInfo.output);
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

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.relative
               );
               const compiledPath = path.join(compiledSourcePath.replace(file.extname, '.min.xhtml'));
               const [, result] = await execInPool(
                  taskParameters.pool,
                  'readCompiledFile',
                  [
                     compiledPath,
                     taskParameters.cache.getCompiledHash(relativeFilePath),
                     taskParameters.cache.getHash(relativeFilePath)
                  ],
                  file.history[0],
                  moduleInfo
               );

               if (result) {
                  file.useSymlink = true;
                  moduleInfo.cache.storeBuildedMarkup(relativeFilePath, {
                     nodeName: `html!${relativeFilePath.replace('.xhtml', '').replace(/\\/g, '/')}`,
                     text: result
                  });
                  const newFile = file.clone();
                  newFile.contents = Buffer.from(result);
                  newFile.path = outputMinFile;
                  newFile.base = moduleInfo.output;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  this.push(newFile);
                  let relativeOutputFile = path.relative(moduleInfo.output, outputMinFile);
                  relativeOutputFile = path.join(moduleName, relativeOutputFile);
                  if (file.versioned) {
                     moduleInfo.cache.storeVersionedModule(relativeFilePath, relativeOutputFile);
                     file.versioned = false;
                  }
                  taskParameters.cache.addOutputFile(relativeFilePath, outputMinFile, moduleInfo);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.history[0]}. It has to be compiled, then.`);
            }

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
                  error: errorBuild,
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
               taskParameters.storePluginTime('build xhtml', resultBuild.passedTime, true);
               moduleInfo.cache.storeBuildedMarkup(relativeFilePath, resultBuild);
               newText = resultBuild.text;

               // если xhtml не возможно минифицировать, то запишем оригинал

               const [error, obj] = await execInPool(taskParameters.pool, 'uglifyJs', [file.path, newText, true]);
               taskParameters.storePluginTime('build xhtml', obj.passedTime, true);
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

            let relativeOutputFile = path.relative(moduleInfo.output, outputMinFile);
            relativeOutputFile = path.join(moduleName, relativeOutputFile);
            if (file.versioned) {
               moduleInfo.cache.storeVersionedModule(relativeFilePath, relativeOutputFile);
               file.versioned = false;
            }
            this.push(
               new Vinyl({
                  base: moduleInfo.output,
                  path: outputMinFile,
                  contents: Buffer.from(newText),
                  history: [...file.history],
                  pushToServer: taskParameters.config.staticServer
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
