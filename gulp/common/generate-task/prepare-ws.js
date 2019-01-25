/**
 * Генерация задачи для подготовки WS к исполнению в builder'е.
 * Из-за того, что часть кода написана на ES5 (AMD модули), а другая часть на ES6 и TypeScript,
 * нужно привести к одному знаменателю.
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   os = require('os'),
   fs = require('fs-extra'),
   gulp = require('gulp'),
   plumber = require('gulp-plumber'),
   gulpChmod = require('gulp-chmod'),
   workerPool = require('workerpool'),
   pluginCompileEsAndTs = require('../../builder/plugins/compile-es-and-ts-simple'),
   TaskParameters = require('../../common/classes/task-parameters'),
   logger = require('../../../lib/logger').logger();

const {
   generateTaskForTerminatePool
} = require('../helpers');

/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters параметры задачи
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForPrepareWS(taskParameters) {
   /**
    * в случае отсутствия необоходимости сборки шаблонов
    * нам не нужно совершать предварительную компиляцию
    * ядра и его инициализацию в пуле воркеров, поэтому
    * данную таску можно пропустить.
    * Исключение - тесты билдера. Для них надо
    * инициализировать ядро.
    */
   if (!taskParameters.config.needTemplates && !taskParameters.config.builderTests) {
      return function skipPrepareWS(done) {
         done();
      };
   }

   const pool = workerPool.pool(path.join(__dirname, '../worker-compile-es-and-ts.js'), {

      // Нельзя занимать больше ядер чем есть. Основной процесс тоже потребляет ресурсы
      maxWorkers: os.cpus().length - 1 || 1,
      env: {
         'main-process-cwd': process.cwd()
      },
      forkOpts: {
         execArgv: ['--max-old-space-size=1024']
      }
   });

   const localTaskParameters = new TaskParameters(taskParameters.config, taskParameters.cache, false, pool);
   const seriesTask = [generateTaskForRemoveOldFiles(taskParameters)];
   const requiredModules = taskParameters.config.modules.filter(moduleInfo => moduleInfo.required);
   if (requiredModules.length) {
      seriesTask.push(
         gulp.parallel(
            requiredModules
               .map(moduleInfo => generateTaskForPrepareWSModule(localTaskParameters, moduleInfo))
         )
      );
   }
   seriesTask.push(generateTaskForTerminatePool(localTaskParameters));
   return gulp.series(seriesTask);
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
         .pipe(pluginCompileEsAndTs(localTaskParameters, moduleInfo))
         .pipe(gulpChmod({ read: true, write: true }))
         .pipe(gulp.dest(moduleOutput));
   };
}

function generateTaskForRemoveOldFiles(taskParameters) {
   return function removeOldPlatformFiles() {
      return fs.remove(path.join(taskParameters.config.cachePath, 'platform'));
   };
}

module.exports = generateTaskForPrepareWS;
