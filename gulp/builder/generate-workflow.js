/**
 * Генерирует поток выполнения сборки статики
 * @author Бегунов Ал. В.
 */

'use strict';

const fs = require('fs-extra'),
   gulp = require('gulp'),
   pMap = require('p-map'),
   path = require('path');

const generateTaskForBuildModules = require('./generate-task/build-modules'),
   generateTaskForCollectThemes = require('./generate-task/collect-style-themes'),
   generateTaskForFinalizeDistrib = require('./generate-task/finalize-distrib'),
   generateTaskForGzip = require('./generate-task/gzip'),
   generateTaskForPackHtml = require('./generate-task/pack-html'),
   generateTaskForCustomPack = require('./generate-task/custom-packer'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForPrepareWS = require('../common/generate-task/prepare-ws'),
   generateTaskForSaveLoggerReport = require('../common/generate-task/save-logger-report'),
   Cache = require('./classes/cache'),
   Configuration = require('./classes/configuration.js'),
   TaskParameters = require('../common/classes/task-parameters');

const {
   generateTaskForLoadCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool
} = require('../common/helpers');

/**
 * Генерирует поток выполнения сборки статики
 * @param {string[]} processArgv массив аргументов запуска утилиты
 * @returns {Undertaker.TaskFunction} gulp задача
 */
function generateWorkflow(processArgv) {
   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv); // eslint-disable-line no-sync

   const taskParameters = new TaskParameters(
      config,
      new Cache(config),
      config.localizations.length > 0
   );

   return gulp.series(

      // generateTaskForLock прежде всего
      guardSingleProcess.generateTaskForLock(taskParameters),
      generateTaskForLoadCache(taskParameters),
      generateTaskForCollectThemes(taskParameters, config),

      // в generateTaskForClearCache нужен загруженный кеш
      generateTaskForClearCache(taskParameters),

      // подготовка WS для воркера
      generateTaskForPrepareWS(taskParameters),
      generateTaskForInitWorkerPool(taskParameters),
      generateTaskForGenerateJson(taskParameters),
      generateTaskForBuildModules(taskParameters),

      generateTaskForRemoveFiles(taskParameters),
      generateTaskForSaveCache(taskParameters),
      generateTaskForTerminatePool(taskParameters),
      generateTaskForFinalizeDistrib(taskParameters),
      generateTaskForPackHtml(taskParameters),
      generateTaskForCustomPack(taskParameters),
      generateTaskForTerminatePool(taskParameters),
      generateTaskForGzip(taskParameters),
      generateTaskForSaveJoinedMeta(taskParameters),
      generateTaskForSaveLoggerReport(taskParameters),

      // generateTaskForUnlock после всего
      guardSingleProcess.generateTaskForUnlock()
   );
}

/**
 * Сохраняем в корень каталога основные мета-файлы сборщика, используемые в дальнейшем
 * в онлайн-продуктах:
 * 1) contents - основная мета-информация, необходимая для настройки require и функционирования
 * приложения.
 * 2) module-dependencies - используется плагином SBIS Dependency Tree.
 * Остальные файлы(bundles.json и bundlesRoute.json) будут сохранены в соответствующей таске по
 * сохранению результатов кастомной паковки.
 * @param taskParameters
 * @returns {Promise<void>}
 */
function generateTaskForSaveJoinedMeta(taskParameters) {
   if (!taskParameters.config.joinedMeta) {
      return function skipSavejoinedMeta(done) {
         done();
      };
   }
   return async function savejoinedMeta() {
      // save joined module-dependencies for non-jinnee application
      const root = taskParameters.config.rawConfig.output;
      if (taskParameters.config.dependenciesGraph) {
         await fs.writeJson(
            path.join(
               root,
               'module-dependencies.json'
            ),
            taskParameters.cache.getModuleDependencies()
         );
      }
      if (!taskParameters.config.customPack) {
         await fs.writeFile(path.join(root, 'bundles.js'), 'bundles={};');
      }
      if (taskParameters.config.commonContents) {
         await fs.writeJson(
            path.join(
               root,
               'contents.json'
            ),
            taskParameters.config.commonContents
         );
         await fs.writeFile(
            path.join(
               root,
               'contents.js'
            ),
            `contents=${JSON.stringify(taskParameters.config.commonContents)};`
         );
         if (taskParameters.config.isReleaseMode) {
            await fs.writeFile(
               path.join(
                  root,
                  'contents.min.js'
               ),
               `contents=${JSON.stringify(taskParameters.config.commonContents)};`
            );
         }
      }
      await fs.writeFile(
         path.join(
            root,
            'router.js'
         ),
         'define(\'router\', [], function(){ return {}; })'
      );
   };
}

function generateTaskForClearCache(taskParameters) {
   return function clearCache() {
      return taskParameters.cache.clearCacheIfNeeded(taskParameters);
   };
}

function generateTaskForSaveCache(taskParameters) {
   return function saveCache() {
      return taskParameters.cache.save();
   };
}

function generateTaskForRemoveFiles(taskParameters) {
   return async function removeOutdatedFiles() {
      const filesForRemove = await taskParameters.cache.getListForRemoveFromOutputDir();
      return pMap(filesForRemove, filePath => fs.remove(filePath), {
         concurrency: 20
      });
   };
}

module.exports = generateWorkflow;
