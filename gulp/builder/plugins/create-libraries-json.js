/**
 * Plugin for generating libraries.json(list of module libraries)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   path = require('path'),
   helpers = require('../../../lib/helpers'),
   fs = require('fs-extra'),
   transliterate = require('../../../lib/transliterate');

/**
 * Gulp plugin declaration
 * @param {ModuleInfo} moduleInfo base module info
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const libraries = [];
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         // check for library from builder cache. Works in incremental build and always has actual
         // meta about every ts file processed by builder
         const currentComponentInfo = moduleInfo.cache.getCurrentComponentInfo(file.history[0]);
         if (file.library || (currentComponentInfo && currentComponentInfo.libraryName)) {
            libraries.push(file);
            callback(null);
         } else {
            callback(null, file);
         }
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const startTime = Date.now();
         try {
            let librariesMeta = [];
            const prettyCacheModulePath = helpers.prettifyPath(transliterate(moduleInfo.output));
            if (await fs.pathExists(path.join(prettyCacheModulePath, '.builder/libraries.json'))) {
               librariesMeta = await fs.readJson(path.join(prettyCacheModulePath, '.builder/libraries.json'));
            }
            const prettyModulePath = helpers.prettifyPath(transliterate(moduleInfo.path));
            const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
            const librariesPaths = libraries.map((currentFile) => {
               const
                  prettyFilePath = transliterate(helpers.prettifyPath(currentFile.path)),
                  isSourcePath = prettyFilePath.includes(prettyModulePath),
                  relativePath = path.relative(isSourcePath ? prettyModulePath : prettyCacheModulePath, prettyFilePath);

               return helpers.unixifyPath(path.join(currentModuleName, relativePath));
            });

            librariesPaths.forEach((libraryPath) => {
               const normalizedPath = libraryPath
                  .replace(/\.ts$/, '')
                  .replace(/(\.min)?\.js$/, '');
               if (!librariesMeta.includes(normalizedPath)) {
                  librariesMeta.push(normalizedPath);
               }
            });

            const file = new Vinyl({
               path: '.builder/libraries.json',
               contents: Buffer.from(JSON.stringify(librariesMeta.sort(), null, 2)),
               moduleInfo
            });
            libraries.forEach(library => this.push(library));
            this.push(file);

            /**
             * save libraries meta by interface modules in taskParameters for customPack task
             * @type {Array}
             */
            taskParameters.librariesMeta[currentModuleName] = librariesMeta;
         } catch (error) {
            logger.error({
               message: 'Builder error for libraries.json generate',
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
