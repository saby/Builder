/**
 * Плагин для минификации css
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   helpers = require('../../../lib/helpers'),
   fs = require('fs-extra');

const { stylesToExcludeFromMinify } = require('../../../lib/builder-constants');
const thirdPartyModule = /.*[/\\]third-party[/\\].*/;
const deepOptimizeModules = new Set([
   'Controls',
   'Controls-default-theme'
]);

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

            // dont minify source third-party library if it was already minified
            if (thirdPartyModule.test(file.path) && await fs.pathExists(file.path.replace(/\.css/, '.min.css'))) {
               if (file.cached) {
                  taskParameters.cache.addOutputFile(
                     file.history[0],
                     path.join(moduleInfo.output, file.relative.replace(/\.css$/, '.min.css')),
                     moduleInfo,
                     true
                  );
               }
               callback(null, file);
               return;
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
               taskParameters.cache.getOutputForFile(file.history[0], moduleInfo).forEach((outputFile) => {
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

            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const relativeFilePath = helpers.getRelativePath(
                  moduleInfo.appRoot,
                  file.history[0],
                  moduleInfo.outputRoot
               );
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.relative
               );
               const compiledPath = path.join(compiledSourcePath.replace('.css', '.min.css'));

               // for css there is only a symlink needed to be created, so we can get a result faster
               // due to avoid read of compiled and minified css file
               if (taskParameters.cache.compareWithCompiled(moduleInfo, relativeFilePath)) {
                  const newFile = file.clone();

                  newFile.base = moduleInfo.output;
                  newFile.path = outputMinFile;
                  newFile.origin = compiledPath;
                  newFile.compiledBase = compiledBase;
                  newFile.useSymlink = true;
                  if (!file.unitedDict && file.history[0].endsWith('.css')) {
                     file.useSymlink = true;
                  }
                  this.push(newFile);
                  taskParameters.cache.addOutputFile(file.history[0], outputMinFile, moduleInfo);
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding minified compiled file for source file: ${file.history[0]}. It has to be compiled, then.`);
            }

            // если файл не возможно минифицировать, то запишем оригинал
            let newText = file.contents.toString();

            const [error, minified] = await execInPool(
               taskParameters.pool,
               'minifyCss',
               [newText, deepOptimizeModules.has(moduleInfo.name)]
            );
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
