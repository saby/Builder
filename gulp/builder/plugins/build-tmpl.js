/* eslint-disable no-invalid-this */

/**
 * Plugin for compiling xml from wml/tmpl files into js,
 * these will be replaced by patched file with localization
 * inside of it if project needs to be localized.
 * Generates minified and compiled *.min.(tmpl/wml) if uglify
 * is enabled in current build.
 * @author Kolbeshin F.A.
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
 * Plugin declaration
 * @param {TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current html
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

         // Write original file if tmpl can't be compiled
         let newText = file.contents.toString();
         let relativeFilePath = path.relative(moduleInfo.path, file.history[0]);
         relativeFilePath = path.join(path.basename(moduleInfo.path), relativeFilePath);
         const extension = file.extname.slice(1, file.extname.length);

         const [error, result] = await execInPool(
            taskParameters.pool,
            'buildTmpl',
            [newText, relativeFilePath, componentsPropertiesFilePath],
            relativeFilePath,
            moduleInfo
         );

         if (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);

            logger.error({
               message: `Error compiling ${extension.toUpperCase()}`,
               error,
               moduleInfo,
               filePath: relativeFilePath
            });
         } else {
            taskParameters.storePluginTime('build tmpl', result.passedTime, true);
            const externalPrivateDependencies = checkForExternalPrivateDeps(
               moduleName,
               result.dependencies
            );
            if (externalPrivateDependencies.length > 0) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               const message = 'Template compiling error. Private modules usage was discovered from ' +
                  `external Interface module. Bad dependencies list: [${externalPrivateDependencies.toString()}]. ` +
                  'Please, for each private module use the corresponding library.';
               logger.warning({
                  message,
                  moduleInfo,
                  filePath: relativeFilePath
               });
            }

            /**
             * Store version-conjunction meta in markup cache to be extracted and used
             * further in self-dependencies packing, furthermore this is the best way to determine
             * whether or not packed component should be marked as one with version-conjunction.
             * Do the same to cdn meta.
             */
            if (file.versioned) {
               result.versioned = true;
            }
            if (file.cdnLinked) {
               result.cdnLinked = true;
            }
            moduleInfo.cache.storeBuildedMarkup(file.history[0], result);
            newText = result.text;

            // save compiled result into source file if we have to
            if (taskParameters.config.debugCustomPack) {
               file.contents = Buffer.from(newText);
            }

            if (taskParameters.config.isReleaseMode) {
               // Write original file if tmpl can't be compiled

               const [errorUglify, obj] = await execInPool(
                  taskParameters.pool,
                  'uglifyJs',
                  [file.path, newText, true],
                  relativeFilePath.replace(templateExtReg, '.min$1'),
                  moduleInfo
               );
               if (errorUglify) {
                  taskParameters.cache.markFileAsFailed(file.history[0]);

                  /**
                   * Uglify-js returns errors as 2 params based object:
                   * 1)message - single message of error occurred.
                   * 2)stack - the message with additional call stack.
                   * Use second option for logs.
                   */
                  logger.error({
                     message: `Error occurred while minify'ing compiled ${extension.toUpperCase()}: ${errorUglify.stack}`,
                     moduleInfo,
                     filePath: relativeFilePath.replace(templateExtReg, '.min$1')
                  });
               } else {
                  taskParameters.storePluginTime('build tmpl', obj.passedTime, true);
                  newText = obj.code;
               }
            }
         }

         if (outputMinFile) {
            if (file.versioned) {
               moduleInfo.cache.storeVersionedModule(file.history[0], outputMinFile);
               file.versioned = false;
            }
            if (file.cdnLinked) {
               moduleInfo.cache.storeCdnModule(file.history[0], outputMinFile);
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
         }
      } catch (error) {
         taskParameters.cache.markFileAsFailed(file.history[0]);
         logger.error({
            message: 'Builder error occurred while compiling tmpl/wml',
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
   });
};
