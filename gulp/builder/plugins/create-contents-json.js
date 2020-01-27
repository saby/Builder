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
         try {
            // подготовим contents.json и contents.js
            if (taskParameters.config.version) {
               moduleInfo.contents.buildnumber = `%{MODULE_VERSION_STUB=${path.basename(moduleInfo.output)}}`;
            }

            // save modular contents.js into joined if needed.
            if (taskParameters.config.joinedMeta) {
               helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
            }

            const contentsJsFile = new Vinyl({
               path: 'contents.js',
               contents: Buffer.from(`contents=${JSON.stringify(helpers.sortObject(moduleInfo.contents))}`),
               moduleInfo,
               compiled: true
            });
            const contentsJsonFile = new Vinyl({
               path: 'contents.json',
               contents: Buffer.from(JSON.stringify(helpers.sortObject(moduleInfo.contents), null, 2)),
               moduleInfo,
               compiled: true
            });
            this.push(contentsJsFile);
            this.push(contentsJsonFile);
            const
               currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop(),
               moduleMeta = moduleInfo.contents.modules[currentModuleName],
               moduleMetaResult = {};

            // in module.js meta i18n needs only "dict" property to use, store it if exists.
            if (moduleMeta.hasOwnProperty('dict')) {
               moduleMetaResult.dict = moduleMeta.dict;
            }

            /**
             * generate AMD-formatted meta for current module localization despite the fact of its content value.
             * Will be completely remove in 20.2100 after completion of the task
             * https://online.sbis.ru/opendoc.html?guid=0f5682ba-f95d-4bf9-a4b7-54a539e54c9d
             */
            const moduleMetaContent = `define('${currentModuleName}/.builder/module',[],function(){return ${JSON.stringify(moduleMetaResult)};});`;
            const moduleMetaFile = new Vinyl({
               path: '.builder/module.js',
               contents: Buffer.from(moduleMetaContent),
               moduleInfo,
               compiled: true
            });
            const moduleMetaMinFile = new Vinyl({
               path: '.builder/module.min.js',
               contents: Buffer.from(moduleMetaContent),
               moduleInfo,
               compiled: true
            });
            this.push(moduleMetaFile);
            this.push(moduleMetaMinFile);
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
