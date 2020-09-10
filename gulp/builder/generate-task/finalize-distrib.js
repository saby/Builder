/**
 * Генерация завершающий задачи для Release сборки. Всё что, нельзя делать инкрементально из-за версионирования.
 * @author Kolbeshin F.A.
 */

'use strict';
const gulp = require('gulp'),
   path = require('path'),
   gulpIf = require('gulp-if'),
   plumber = require('gulp-plumber');

const logger = require('../../../lib/logger').logger(),
   versionizeFinish = require('../plugins/versionize-finish'),
   startTask = require('../../common/start-task-with-timer');

/**
 * Генерация завершающий задачи для Release сборки.
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForFinalizeDistrib(taskParameters) {
   if (!taskParameters.config.isReleaseMode || !taskParameters.config.distributive) {
      return function skipFinalizeDistrib(done) {
         done();
      };
   }

   const copyResources = startTask('copy resources', taskParameters);
   return gulp.series(
      copyResources.start,
      generateTaskForCopyResources(taskParameters),
      copyResources.finish
   );
}

function generateTaskForCopyResources(taskParameters) {
   const { config } = taskParameters;
   const modulesToCopy = config.modulesForPatch.length > 0 ? config.modulesForPatch : config.modules;
   const tasks = modulesToCopy.map((moduleInfo) => {
      const input = path.join(moduleInfo.output, '/**/*.*');

      // необходимо, чтобы мы могли копировать содержимое .builder в output
      const dotInput = path.join(moduleInfo.output, '/.*/*.*');
      const moduleOutput = path.join(config.rawConfig.output, path.basename(moduleInfo.output));
      return function copyResources() {
         return gulp
            .src([input, dotInput], { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача copyResources завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(gulpIf(!!config.version, versionizeFinish(taskParameters, moduleInfo)))
            .pipe(gulp.dest(moduleOutput));
      };
   });

   return gulp.parallel(tasks);
}

module.exports = generateTaskForFinalizeDistrib;
