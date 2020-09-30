/**
 * Plugin that adds all of changed files into the "push to server" list
 * for HotReload
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../../lib/logger').logger(),
   path = require('path'),
   through = require('through2');

const GRANTED_EXTENSIONS = [
   '.js',
   '.css',
   '.json',
   '.wml',
   '.tmpl',
   '.xhtml'
];

const NON_CACHED_META = [
   'contents.js',
   'contents.json',
   'ru.js',
   'en.js'
];

/**
 * Plugin declaration
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      try {
         if (GRANTED_EXTENSIONS.includes(file.extname) && !NON_CACHED_META.includes(path.basename(file.relative))) {
            const outputFilePath = path.join(
               path.basename(moduleInfo.output),
               file.relative
            ).replace(/\\/g, '/');
            taskParameters.addChangedFile(outputFilePath);
         }
         callback(null, file);
         return;
      } catch (error) {
         logger.error({ error });
      }
      callback();
   });
};
