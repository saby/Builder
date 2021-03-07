/**
 * Генерирует поток выполнения сборки статики
 * @author Бегунов Ал. В.
 */

'use strict';

const fs = require('fs-extra'),
   gulp = require('gulp'),
   pMap = require('p-map');

const generateTaskForBuildModules = require('./generate-task/build-modules'),
   { generateTaskForCollectThemes } = require('./generate-task/collect-style-themes'),
   generateTaskForFinalizeDistrib = require('./generate-task/finalize-distrib'),
   generateTaskForCompress = require('./generate-task/compress'),
   generateTaskForPackHtml = require('./generate-task/pack-html'),
   generateTaskForCustomPack = require('./generate-task/custom-packer'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForPrepareWS = require('../common/generate-task/prepare-ws'),
   generateTaskForSaveJoinedMeta = require('../common/generate-task/save-joined-meta'),
   { checkModuleDependenciesExisting } = require('../../lib/check-module-dependencies'),
   { typescriptCompiler } = require('../../lib/typescript-compiler'),
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

   // modules for patch - when we need to rebuild part of project modules instead of full rebuild.
   const modulesForPatch = taskParameters.config.modules.filter(moduleInfo => moduleInfo.rebuild);
   return gulp.series(

      // generateTaskForLock прежде всего
      guardSingleProcess.generateTaskForLock(taskParameters),
      generateTaskForLoadCache(taskParameters, modulesForPatch),
      generateTaskForCollectThemes(taskParameters),

      // в generateTaskForClearCache нужен загруженный кеш
      generateTaskForClearCache(taskParameters, modulesForPatch),

      // подготовка WS для воркера
      generateTaskForPrepareWS(taskParameters),
      generateTaskForInitWorkerPool(taskParameters),
      generateTaskForGenerateJson(taskParameters),
      generateTaskForTypescriptCompile(taskParameters),
      generateTaskForBuildModules(taskParameters, modulesForPatch),

      generateTaskForRemoveFiles(taskParameters, modulesForPatch),
      generateTaskForSaveCache(taskParameters),
      generateTaskForFinalizeDistrib(taskParameters, modulesForPatch),
      generateTaskForCheckModuleDeps(taskParameters),
      generateTaskForPackHtml(taskParameters),
      generateTaskForCustomPack(taskParameters),
      generateTaskForCompress(taskParameters),
      generateTaskForTerminatePool(taskParameters),
      generateTaskForSaveJoinedMeta(taskParameters),
      generateTaskForSaveLoggerReport(taskParameters),

      // generateTaskForUnlock после всего
      guardSingleProcess.generateTaskForUnlock()
   );
}

function generateTaskForClearCache(taskParameters, modulesForPatch) {
   return function clearCache() {
      return taskParameters.cache.clearCacheIfNeeded(modulesForPatch.length > 0);
   };
}

function generateTaskForTypescriptCompile(taskParameters) {
   if (!taskParameters.config.tsc) {
      return function skipRunTypescriptCompiler(done) {
         done();
      };
   }
   return function runTypescriptCompiler() {
      return typescriptCompiler(taskParameters);
   };
}

function generateTaskForSaveCache(taskParameters) {
   return function saveCache() {
      return taskParameters.cache.save();
   };
}

function generateTaskForRemoveFiles(taskParameters, modulesForPatch) {
   return async function removeOutdatedFiles() {
      const filesForRemove = await taskParameters.cache.getListForRemoveFromOutputDir(
         taskParameters.config.cachePath,
         modulesForPatch
      );
      return pMap(filesForRemove, filePath => fs.remove(filePath), {
         concurrency: 20
      });
   };
}

function generateTaskForCheckModuleDeps(taskParameters) {
   const { config } = taskParameters;

   /**
    * enable module dependencies checker for plugin and oonline projects.
    * Plugin project installation strictly depends on s3mod-dependencies.
    * Online project also needs dependency check to avoid Server-side errors on web-pages.
    * @type {string|boolean}
    */
   const isPluginBuild = config.rawConfig.cld_name && config.rawConfig.cld_name.startsWith('SbisPlugin');
   const isOnlineInside = config.modules.find(
      moduleInfo => moduleInfo.name === 'OnlineSbisRu'
   );
   if (!(isOnlineInside || isPluginBuild)) {
      return function skipCheckModuleDepsExisting(done) {
         done();
      };
   }
   return function checkModuleDepsExisting() {
      return checkModuleDependenciesExisting(taskParameters);
   };
}

module.exports = generateWorkflow;
