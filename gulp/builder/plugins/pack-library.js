/**
 * Plugin for packing of private parts of libraries.
 * Those are AMD-modules that have a pre-word symbol "_" or to be
 * located inside of directory with pre-word symbol "_" in it's
 * name.
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

function getPrivatePartsCache(moduleInfo) {
   const
      privatePartsCache = moduleInfo.cache.getCompiledEsModuleCache();

   // Take templates cache, it may contain private library dependencies content.
   const markupCache = moduleInfo.cache.getMarkupCache();
   Object.keys(markupCache).forEach((currentKey) => {
      privatePartsCache[currentKey] = markupCache[currentKey];
   });
   return privatePartsCache;
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
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
         const componentsInfo = moduleInfo.cache.getComponentsInfo();
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
                     getPrivatePartsCache(moduleInfo)
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
                   * Builder cache information of dependencies have to be updated by
                   * corresponding result dependencies to take it into consideration
                   * when creating of module-dependencies meta file and to avoid private
                   * library dependencies to be pasted into HTML-page by VDOM server-side
                   * functionality.
                   * @type {string}
                   */
                  if (result.newModuleDependencies) {
                     moduleInfo.cache.storeComponentParameters(library.history[0], {
                        componentDep: result.newModuleDependencies
                     });
                     moduleInfo.cache.storeComponentParameters(library.history[0].replace(/\.(ts|es)$/, '.js'), {
                        componentDep: result.newModuleDependencies
                     });
                  }
                  if (result.fileDependencies && result.fileDependencies.length > 0) {
                     moduleInfo.cache.storeComponentParameters(library.history[0], {
                        packedModules: result.packedModules,
                        libraryName: result.name
                     });
                     taskParameters.cache.addDependencies(library.history[0], result.fileDependencies);
                  }
                  if (result.warnings) {
                     result.warnings.forEach((currentWarning) => {
                        logger.warning({
                           message: currentWarning,
                           filePath: library.history[0],
                           moduleInfo
                        });
                     });
                  }
                  library.library = true;

                  /**
                   * Add packed libraries in versioned_modules and cdn_modules meta file if there are
                   * packed private dependencies with an appropriate content to be replaced further
                   * by jinnee
                   */
                  library.versioned = result.versioned;
                  library.cdnLinked = result.cdnLinked;

                  // add extra logs from library packer into a single file
                  // to have an ability to save logs in builder cache
                  if (result.logs) {
                     const logsFile = library.clone();
                     logsFile.path = `${logsFile.path}.log`;
                     logsFile.contents = Buffer.from(result.logs);
                     this.push(logsFile);
                  }
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
