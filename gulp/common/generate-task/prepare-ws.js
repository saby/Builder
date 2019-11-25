/**
 * Генерация задачи для подготовки WS к исполнению в builder'е.
 * Из-за того, что часть кода написана на ES5 (AMD модули), а другая часть на ES6 и TypeScript,
 * нужно привести к одному знаменателю.
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   gulp = require('gulp'),
   plumber = require('gulp-plumber'),
   gulpChmod = require('gulp-chmod'),
   pluginCompileEsAndTs = require('../../builder/plugins/compile-es-and-ts-simple'),
   gulpIf = require('gulp-if'),
   changedInPlace = require('../../common/plugins/changed-in-place'),
   TaskParameters = require('../../common/classes/task-parameters'),
   startTask = require('../start-task-with-timer'),
   logger = require('../../../lib/logger').logger();

/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters параметры задачи
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForPrepareWS(taskParameters) {
   if (!taskParameters.config.initCore) {
      return function skipPrepareWS(done) {
         done();
      };
   }

   const localTaskParameters = new TaskParameters(taskParameters.config, taskParameters.cache, false);
   localTaskParameters.tasksTimer = taskParameters.tasksTimer;
   const requiredModules = taskParameters.config.modules.filter(moduleInfo => moduleInfo.required);
   const buildWSModule = startTask('buildWSModule', localTaskParameters);
   if (requiredModules.length) {
      return gulp.series(
         buildWSModule.start,
         gulp.parallel(
            requiredModules
               .map(moduleInfo => generateTaskForPrepareWSModule(localTaskParameters, moduleInfo))
         ),
         buildWSModule.finish
      );
   }
   return function skipPrepareWS(done) {
      done();
   };
}

function generateTaskForPrepareWSModule(localTaskParameters, moduleInfo) {
   return function buildWSModule() {
      const moduleInput = path.join(moduleInfo.path, '/**/*.*');
      const moduleOutput = path.join(localTaskParameters.config.cachePath, 'platform', path.basename(moduleInfo.path));
      logger.debug(`Задача buildWSModule. moduleInput: "${moduleInput}", moduleOutput: "${moduleOutput}"`);
      return gulp
         .src(moduleInput, { dot: false, nodir: true })
         .pipe(
            plumber({
               errorHandler(err) {
                  logger.error({
                     message: 'Задача buildWSModule завершилась с ошибкой',
                     error: err,
                     moduleInfo
                  });
                  this.emit('end');
               }
            })
         )

         // builder unit tests dont have cache
         .pipe(gulpIf(!!localTaskParameters.cache, changedInPlace(localTaskParameters, moduleInfo)))
         .pipe(pluginCompileEsAndTs(localTaskParameters, moduleInfo))
         .pipe(gulpChmod({ read: true, write: true }))
         .pipe(gulp.dest(moduleOutput));
   };
}

module.exports = generateTaskForPrepareWS;
