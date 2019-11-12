/* eslint-disable no-invalid-this */

/**
 * Плагин для компиляции xml из *.tmpl файлов в js.
 * В debug (при локализации) заменяет оригинальный файл.
 * В release создаёт новый файл *.min.tmpl.
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   libPackHelpers = require('../../../lib/pack/helpers/librarypack'),
   templateExtReg = /(\.tmpl|\.wml)$/;

/**
 * Проверяем, является ли зависимость скомпилированного шаблона приватной
 * зависимостью из чужого Интерфейсного модуля
 * @param{String} moduleName - имя текущего Интерфейсного модуля
 * @param{Array} dependencies - набор зависимостей скомпилированного шаблона.
 * @returns {Array}
 */
function checkForExternalPrivateDeps(moduleName, dependencies) {
   const result = [];
   dependencies
      .filter(dependencyName => libPackHelpers.isPrivate(dependencyName))
      .forEach((dependencyName) => {
         const
            dependencyParts = dependencyName.split('/'),
            dependencyModule = dependencyParts[0].split(/!|\?/).pop();

         if (dependencyModule !== moduleName) {
            result.push(dependencyName);
         }
      });
   return result;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const componentsPropertiesFilePath = path.join(taskParameters.config.cachePath, 'components-properties.json');
   const moduleName = path.basename(moduleInfo.output);

   return through.obj(async function onTransform(file, encoding, callback) {
      try {
         if (!['.tmpl', '.wml'].includes(file.extname)) {
            callback(null, file);
            return;
         }
         if (!taskParameters.config.templateBuilder) {
            logger.warning({
               message: '"View" or "UI" interface module doesn\'t exists in current project. "*.tmpl/*.wml" templates will be ignored',
               moduleInfo,
               filePath: file.path
            });
            callback(null, file);
            return;
         }
         let outputMinFile = '';
         if (taskParameters.config.isReleaseMode) {
            const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(templateExtReg, '.min$1');
            outputMinFile = path.join(moduleInfo.output, transliterate(relativePath));
         }
         if (file.cached) {
            if (outputMinFile) {
               taskParameters.cache.addOutputFile(file.history[0], outputMinFile, moduleInfo);
            }
            callback(null, file);
            return;
         }

         // если tmpl не возможно скомпилировать, то запишем оригинал
         let newText = file.contents.toString();
         let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
         relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);

         const [error, result] = await execInPool(
            taskParameters.pool,
            'buildTmpl',
            [newText, relativeFilePath, componentsPropertiesFilePath, file.extname.slice(1, file.extname.length)],
            relativeFilePath,
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);

            logger.error({
               message: 'Ошибка компиляции TMPL',
               error,
               moduleInfo,
               filePath: relativeFilePath
            });
         } else {
            const externalPrivateDependencies = checkForExternalPrivateDeps(
               moduleName,
               result.dependencies
            );
            if (externalPrivateDependencies.length > 0) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               const message = 'Ошибка компиляции шаблона. Обнаружено использование приватных модулей из ' +
                  `чужого Интерфейсного модуля. Список таких зависимостей: [${externalPrivateDependencies.toString()}]. ` +
                  'Используйте соответствующую данному приватному модулю библиотеку';
               logger.warning({
                  message,
                  moduleInfo,
                  filePath: relativeFilePath
               });
            }

            /**
             * запишем в markupCache информацию о версионировании, поскольку
             * markupCache извлекаем при паковке собственных зависимостей. Так
             * можно легко обьединить, помечать компонент как версионированный или нет.
             * Аналогичная ситуация и для шаблонов с ссылками на cdn
             */
            if (file.versioned) {
               result.versioned = true;
            }
            if (file.cdnLinked) {
               result.cdnLinked = true;
            }
            taskParameters.cache.storeBuildedMarkup(file.history[0], moduleInfo.name, result);
            newText = result.text;

            if (taskParameters.config.isReleaseMode) {
               // если tmpl/wml невозможно минифицировать, то запишем оригинал

               const [errorUglify, obj] = await execInPool(
                  taskParameters.pool,
                  'minifyJs',
                  [file.path, newText, true],
                  relativeFilePath.replace(templateExtReg, '.min$1'),
                  moduleInfo
               );
               if (errorUglify) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);

                  /**
                   * ошибку uglify-js возвращает в виде объекта с 2мя свойствами:
                   * 1)message - простое сообщение ошибки.
                   * 2)stack - сообщение об ошибке + стек вызовов.
                   * Воспользуемся для вывода вторым.
                   */
                  logger.error({
                     message: `Ошибка минификации скомпилированного TMPL: ${errorUglify.stack}`,
                     moduleInfo,
                     filePath: relativeFilePath.replace(templateExtReg, '.min$1')
                  });
               } else {
                  newText = obj.code;
               }
            }
         }

         if (outputMinFile) {
            if (file.versioned) {
               taskParameters.cache.storeVersionedModule(file.history[0], moduleInfo.name, outputMinFile);
               file.versioned = false;
            }
            if (file.cdnLinked) {
               taskParameters.cache.storeCdnModule(file.history[0], moduleInfo.name, outputMinFile);
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
         } else {
            file.contents = Buffer.from(newText);
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.history[0]);
         logger.error({
            message: "Ошибка builder'а при компиляции TMPL",
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
   });
};
