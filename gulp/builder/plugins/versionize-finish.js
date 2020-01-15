/**
 * Post-incremental build plugin for version-conjugation.
 * Doing rollback of version-conjugation in links of source-files
 * and saves as is conjugated links in compiled minified files.
 * In dependent of versionize-to-stub
 * @author Begunov A.V.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger();

const versionRegex = /(\.min)?(\.[\w]+?)\?x_module=%{MODULE_VERSION_STUB=.+?}/g;

// urls without version. For multi-service applications with the same domain
const uniqueUrls = /(bundles|contents)\.min\.js/g;
const includeExts = ['.css', '.js', '.html', '.tmpl', '.xhtml', '.wml'];

/**
 * Plugin declaration
 * @param{TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @param{ModuleInfo} moduleInfo core info about the interface module
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(function onTransform(file, encoding, callback) {
      const startTime = Date.now();
      try {
         if (!includeExts.includes(file.extname)) {
            callback(null, file);
            taskParameters.storePluginTime('versionize', startTime);
            return;
         }

         if (!(file.path.match(/\.min\.[^.\\/]+$/) || file.extname === '.html')) {
            const text = file.contents.toString();
            file.contents = Buffer.from(
               text
                  .replace(versionRegex, '$2')
                  .replace(uniqueUrls, '$1.js')
            );
         }
      } catch (error) {
         logger.error({
            message: "Builder's error occurred by version-conjugation task",
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
      taskParameters.storePluginTime('versionize', startTime);
   });
};
