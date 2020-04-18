/**
 * Task for saving meta about module new themes into current module's contents meta
 */

'use strict';
const plumber = require('gulp-plumber');
const path = require('path');
const gulp = require('gulp');
const logger = require('../../../lib/logger').logger();
const through = require('through2');
const helpers = require('../../../lib/helpers');
const Vinyl = require('vinyl');
const startTask = require('../../common/start-task-with-timer');

function saveNewThemesToContents(taskParameters, moduleInfo) {
   return through.obj(

      /* @this Stream */
      function onTransform(file, encode, callback) {
         const currentContents = JSON.parse(file.contents);
         const themeModules = taskParameters.cache.getNewThemesModulesCache(moduleInfo.name);
         if (Object.keys(themeModules).length > 0) {
            currentContents.modules[moduleInfo.runtimeModuleName].newThemes = themeModules;
         }

         // save current module contents into root common contents if needed
         if (taskParameters.config.joinedMeta) {
            helpers.joinContents(taskParameters.config.commonContents, currentContents);
         }

         const newFile = file.clone();
         newFile.contents = Buffer.from(JSON.stringify(helpers.sortObject(currentContents), null, 2));
         this.push(newFile);
         const contentsJsFile = new Vinyl({
            path: 'contents.js',
            contents: Buffer.from(`contents=${JSON.stringify(helpers.sortObject(currentContents))}`),
            moduleInfo
         });
         this.push(contentsJsFile);

         // readed contents is not needed anymore, so throw it out from the gulp stream.
         callback(null);
      }
   );
}

module.exports = function generateTaskForSaveNewThemes(taskParameters) {
   const { config } = taskParameters;
   if (!config.contents) {
      return function skipSaveNewThemes(done) {
         done();
      };
   }
   const modulesForBuild = config.modulesForPatch.length > 0 ? config.modulesForPatch : config.modules;
   const tasks = modulesForBuild.map((moduleInfo) => {
      const input = path.join(moduleInfo.output, '/contents.json');
      return function saveNewThemes() {
         return gulp
            .src(input, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Task saveNewThemes was completed with errors',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(saveNewThemesToContents(taskParameters, moduleInfo))
            .pipe(gulp.dest(moduleInfo.output));
      };
   });
   const saveNewThemes = startTask('save new themes', taskParameters);
   return gulp.series(
      saveNewThemes.start,
      gulp.parallel(tasks),
      saveNewThemes.finish
   );
};
