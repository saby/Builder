/**
 * Генерация задачи архивации для файлов
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp'),
   fs = require('fs-extra'),
   path = require('path'),
   plumber = require('gulp-plumber');

const startTask = require('../../common/start-task-with-timer');

const compressPlugin = require('../plugins/compress'),
   logger = require('../../../lib/logger').logger();

/**
 * Save hash by content of minified files to be used in incremental build.
 * @param{TaskParameters} taskParameters - a whole parameters list for current project build.
 * @returns {saveCompressArtifacts}
 */
function postProcessCompressTask(taskParameters) {
   return async function saveCompressArtifacts() {
      await fs.outputJson(path.join(taskParameters.config.cachePath, 'cached-minified.json'), taskParameters.cache.getCachedMinified());
   };
}

/**
 * Генерация задачи архивации для файлов
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCompress(taskParameters) {
   // for local stands there is no practical need of using archives, it just increases build time.
   if (!taskParameters.config.compress || taskParameters.config.localStand) {
      return function skipCompress(done) {
         done();
      };
   }

   const tasks = taskParameters.config.modules.map((moduleInfo) => {
      const moduleOutput = path.join(taskParameters.config.rawConfig.output, path.basename(moduleInfo.output));

      // generate compressed resources only for minified content and fonts.
      const input = path.join(moduleOutput, '/**/*.min.{js,json,css,tmpl,wml,ttf}');

      return function compress() {
         return gulp
            .src(input, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача compress завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(compressPlugin(taskParameters, moduleInfo))
            .pipe(gulp.dest(moduleOutput));
      };
   });

   const compressTask = startTask('compress', taskParameters);
   return gulp.series(
      compressTask.start,
      gulp.parallel(tasks),
      postProcessCompressTask(taskParameters),
      compressTask.finish
   );
}

module.exports = generateTaskForCompress;
