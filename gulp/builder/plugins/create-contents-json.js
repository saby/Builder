/**
 * Gulp plugin for creating of contents.json and contents.js meta files
 * (information for require.js, localization description, etc.)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   path = require('path'),
   helpers = require('../../../lib/helpers');

/**
 * Plugin declaration
 * @param {BuildConfiguration} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   if (
      taskParameters.config.joinedMeta &&
      !taskParameters.config.commonContents
   ) {
      taskParameters.config.commonContents = {};
   }
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         callback(null, file);
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         const moduleName = path.basename(moduleInfo.output);
         try {
            // подготовим contents.json и contents.js
            if (taskParameters.config.version) {
               moduleInfo.contents.buildnumber = `%{MODULE_VERSION_STUB=${moduleName}}`;
            }

            // save modular contents.js into joined if needed.
            if (taskParameters.config.joinedMeta) {
               helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
            }
            const sortedContents = JSON.stringify(helpers.sortObject(moduleInfo.contents));
            const contentsBuffer = Buffer.from(sortedContents);
            const contentsJsonFile = new Vinyl({
               path: 'contents.json',
               contents: contentsBuffer,
               moduleInfo,
               compiled: true
            });
            const contentsJsonJsFile = new Vinyl({
               path: 'contents.json.js',
               contents: Buffer.from(`define('${moduleName}/contents.json',[],function(){return ${sortedContents};});`),
               moduleInfo,
               compiled: true
            });
            this.push(contentsJsonJsFile);
            this.push(contentsJsonFile);
            if (taskParameters.config.isReleaseMode) {
               const contentsMinJsonFile = new Vinyl({
                  path: 'contents.min.json',
                  contents: contentsBuffer,
                  moduleInfo,
                  compiled: true
               });
               this.push(contentsMinJsonFile);
               const contentsJsonMinJsFile = new Vinyl({
                  path: 'contents.json.min.js',
                  contents: Buffer.from(`define('${moduleName}/contents.json',[],function(){return ${sortedContents};});`),
                  moduleInfo,
                  compiled: true
               });
               this.push(contentsJsonMinJsFile);
            }
         } catch (error) {
            logger.error({
               message: 'Builder error',
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
