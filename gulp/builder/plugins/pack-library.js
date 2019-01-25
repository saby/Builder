/**
 * Плагин для паковки приватных частей библиотеки.
 * Приватная часть библиотеки - AMD-модуль, в начале имени
 * которого присутствует символ "_" или расположенных в
 * поддиректории папки, имя которой начинается с "_"
 * @author Колбешин Ф.А.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   libPackHelpers = require('../../../lib/pack/helpers/librarypack'),
   pMap = require('p-map'),
   execInPool = require('../../common/exec-in-pool'),
   helpers = require('../../../lib/helpers'),
   esExt = /\.(es|ts)$/;

function getPrivatePartsCache(taskParameters, moduleInfo) {
   const
      privatePartsCache = taskParameters.cache.getCompiledEsModuleCache(moduleInfo.name);

   // кэш шаблонов также необходим, среди них могут быть приватные части библиотеки.
   const markupCache = taskParameters.cache.getMarkupCache(moduleInfo.name);
   Object.keys(markupCache).forEach((currentKey) => {
      privatePartsCache[currentKey] = markupCache[currentKey];
   });
   return privatePartsCache;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const libraries = [];
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         if (
            file.extname === '.js' &&
            esExt.test(file.history[0]) &&
            !libPackHelpers.isPrivate(path.relative(moduleInfo.output, file.path))
         ) {
            libraries.push(file);
            callback();
         } else {
            callback(null, file);
         }
      },

      /* @this Stream */
      async function onFlush(callback) {
         const sourceRoot = moduleInfo.path.replace(moduleInfo.name, '');
         await pMap(
            libraries,
            async(library) => {
               const [error, result] = await execInPool(
                  taskParameters.pool,
                  'packLibrary',
                  [
                     sourceRoot,
                     library.contents.toString(),
                     getPrivatePartsCache(taskParameters, moduleInfo)
                  ],
                  library.history[0],
                  moduleInfo
               );
               if (error) {
                  logger.error({
                     message: 'Ошибка при паковке библиотеки',
                     error,
                     filePath: library.history[0]
                  });
               } else {
                  library.modulepack = result.compiled;

                  /**
                   * Для запакованных библиотек нужно обновить информацию в кэше о
                   * зависимостях, чтобы при создании module-dependencies учитывалась
                   * информация о запакованных библиотеках и приватные модули из
                   * библиотек не вставлялись при Серверном рендеринге на VDOM
                   * @type {string}
                   */
                  const
                     prettyPath = helpers.unixifyPath(library.history[0]),
                     prettyCompiledPath = prettyPath.replace(/\.(ts|es)$/, '.js'),
                     currentModuleStore = taskParameters.cache.currentStore.modulesCache[moduleInfo.name];

                  if (result.newModuleDependencies) {
                     if (currentModuleStore.componentsInfo[prettyPath]) {
                        currentModuleStore.componentsInfo[prettyPath].componentDep = result.newModuleDependencies;
                     }
                     const compiledComponentsInfo = currentModuleStore.componentsInfo[prettyCompiledPath];
                     if (compiledComponentsInfo) {
                        compiledComponentsInfo.componentDep = result.newModuleDependencies;
                     }
                  }
                  if (result.fileDependencies && result.fileDependencies.length > 0) {
                     taskParameters.cache.addDependencies(library.history[0], result.fileDependencies);
                  }
                  library.library = true;
               }
               this.push(library);
            },
            {
               concurrency: 10
            }
         );
         callback(null);
      }
   );
};
