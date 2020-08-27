/**
 * Post-incremental build plugin for version-conjunction.
 * Doing rollback of version-conjunction in links of source-files
 * and saves as is conjugated links in compiled minified files.
 * In dependent of versionize-to-stub
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger();

const mainRegex = /(\.min)?(\.[\w]+?)\?x_module=%{MODULE_VERSION_STUB=.+?}/g;
const includeExts = ['.css', '.js', '.html', '.tmpl', '.xhtml', '.wml'];

/**
 * Plugin declaration
 * @param{TaskParameters} taskParameters - whole parameters list(gulp configuration, all builder cache, etc. )
 * using by current running Gulp-task.
 * @param{ModuleInfo} moduleInfo core info about the interface module
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const versionNumber = taskParameters.config.multiService ? '%{BUILDER_VERSION_STUB}' : taskParameters.config.version;

   // regex for main root URLs. We have to remove version headers from files that has to be used in page with s3debug
   const rootUrlsRegex = new RegExp(
      `(bundles|contents|router)\\.min\\.js(\\?x_module=${versionNumber})?(&x_app=%{PRODUCT_NAME})?`,
      'g'
   );
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
                  .replace(mainRegex, '$2')
                  .replace(rootUrlsRegex, '$1.js')
            );
         }
      } catch (error) {
         logger.error({
            message: "Builder's error occurred by do-version-header-conjunction task",
            error,
            moduleInfo,
            filePath: file.path
         });
      }
      callback(null, file);
      taskParameters.storePluginTime('versionize', startTime);
   });
};
