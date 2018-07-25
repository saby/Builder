/**
 * Генерирует поток выполнения сбора локализуемых фраз
 * @author Бегунов Ал. В.
 */

'use strict';

// модули из npm
const path = require('path'),
   gulp = require('gulp'),
   os = require('os'),
   fs = require('fs-extra'),
   workerPool = require('workerpool'),
   plumber = require('gulp-plumber');

const guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   changedInPlace = require('../common/plugins/changed-in-place'),
   grabFile = require('./plugins/grab-file'),
   Configuration = require('./classes/configuration.js'),
   Cache = require('./classes/cache.js'),
   logger = require('../../lib/logger').logger();

/**
 * Генерирует поток выполнения сбора локализуемых фраз
 * @param {string[]} processArgv массив аргументов запуска утилиты
 * @returns {Undertaker.TaskFunction} gulp задача
 */
function generateWorkflow(processArgv) {
   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv); // eslint-disable-line no-sync

   const cache = new Cache(config);

   const pool = workerPool.pool(path.join(__dirname, '../common/worker.js'), {

      // Нельзя занимать больше ядер чем есть. Основной процесс тоже потребляет ресурсы
      maxWorkers: os.cpus().length - 1 || 1
   });

   return gulp.series(

      //  generateTaskForLock прежде всего
      guardSingleProcess.generateTaskForLock(config.cachePath),
      generateTaskForLoadCache(cache),
      generateTaskForGenerateJson(cache, config),
      generateTaskForGrabModules(cache, config, pool),
      gulp.parallel(

         // завершающие задачи
         generateTaskForSaveCache(cache),
         generateTaskForSaveOutputJson(cache, config),
         generateTaskForTerminatePool(pool)
      ),

      // generateTaskForUnlock после всего
      guardSingleProcess.generateTaskForUnlock()
   );
}

function generateTaskForTerminatePool(pool) {
   return function terminatePool() {
      return pool.terminate();
   };
}

function generateTaskForSaveCache(cache) {
   return function saveCache() {
      return cache.save();
   };
}

function generateTaskForLoadCache(cache) {
   return function loadCache() {
      return cache.load();
   };
}

function generateTaskForGrabSingleModule(config, moduleInfo, cache, pool) {
   const moduleInput = path.join(moduleInfo.path, '/**/*.@(js|xhtml|tmpl)');

   return function grabModule() {
      return gulp
         .src(moduleInput, { dot: false, nodir: true })
         .pipe(
            plumber({
               errorHandler(err) {
                  logger.error({
                     message: 'Задача grabModule завершилась с ошибкой',
                     error: err,
                     moduleInfo
                  });
                  this.emit('end');
               }
            })
         )
         .pipe(changedInPlace(cache))
         .pipe(grabFile(config, cache, moduleInfo, pool))
         .pipe(gulp.dest(moduleInfo.path));
   };
}

function generateTaskForGrabModules(taskParameters, config) {
   const tasks = [];
   let countCompletedModules = 0;

   const printPercentComplete = function(done) {
      countCompletedModules += 1;
      logger.progress((100 * countCompletedModules) / config.modules.length);
      done();
   };

   for (const moduleInfo of config.modules) {
      tasks.push(
         gulp.series(
            generateTaskForGrabSingleModule(config, moduleInfo, taskParameters.cache, taskParameters.pool),
            printPercentComplete
         )
      );
   }
   return gulp.parallel(tasks);
}

function generateTaskForSaveOutputJson(cache, config) {
   return async function saveOutputJson() {
      await fs.writeJSON(config.outputPath, cache.getCachedWords(), { spaces: 1 });
   };
}

module.exports = generateWorkflow;
