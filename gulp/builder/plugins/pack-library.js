/**
 * Плагин для паковки приватных частей библиотеки.
 * Приватная часть библиотеки - AMD-модуль, в начале имени
 * которого присутствует символ "_" или расположенных в
 * поддиректории папки, имя которой начинается с "_"
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   path = require('path'),
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

   // sourceRoot variable is already have unixified module path.
   const sourceRoot = path.dirname(moduleInfo.path);
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         if (
            !helpers.componentCantBeParsed(file) &&
            esExt.test(file.history[0]) &&

            // Correctly get the relative path from the surface of path-ancestors of the compiling library
            !libPackHelpers.isPrivate(
               helpers.removeLeadingSlashes(file.history[0].replace(sourceRoot, ''))
            )
         ) {
            libraries.push(file);
            callback();
         } else {
            callback(null, file);
         }

         taskParameters.storePluginTime('pack libraries', startTime);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const componentsInfo = taskParameters.cache.getComponentsInfo(moduleInfo.name);
         await pMap(
            libraries,
            async(library) => {
               const currentComponentInfo = componentsInfo[helpers.unixifyPath(library.history[0])];

               // ignore ts modules without private dependencies
               if (!currentComponentInfo.privateDependencies) {
                  this.push(library);
                  return;
               }
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
                  taskParameters.cache.markFileAsFailed(library.history[0]);
                  logger.error({
                     message: 'Error while packing library',
                     error,
                     filePath: library.history[0],
                     moduleInfo
                  });
               } else {
                  taskParameters.storePluginTime('pack libraries', result.passedTime, true);
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
                     if (currentModuleStore.componentsInfo[prettyPath]) {
                        currentModuleStore.componentsInfo[prettyPath].packedModules = result.packedModules;
                        currentModuleStore.componentsInfo[prettyPath].libraryName = result.name;
                     }
                     taskParameters.cache.addDependencies(library.history[0], result.fileDependencies);
                  }
                  library.library = true;

                  /**
                   * Also add packed libraries in versioned_modules and cdn_modules meta files in case of
                   * having packed private dependencies with an appropriate content to be replaced further
                   * by jinnee
                   */
                  library.versioned = result.versioned;
                  library.cdnLinked = result.cdnLinked;
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
