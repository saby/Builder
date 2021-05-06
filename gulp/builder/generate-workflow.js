/**
 * Generates a workflow for build of current project static files.
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const gulp = require('gulp');

const generateTaskForBuildModules = require('./generate-task/build-modules'),
   generateTaskForMarkThemeModules = require('./generate-task/mark-theme-modules'),
   generateTaskForFinalizeDistrib = require('./generate-task/finalize-distrib'),
   generateTaskForCompress = require('./generate-task/compress'),
   generateTaskForPackHtml = require('./generate-task/pack-html'),
   generateTaskForCustomPack = require('./generate-task/custom-packer'),
   { generateTaskForRemoveFiles } = require('./generate-task/remove-outdated-files'),
   generateTaskForGenerateJson = require('../common/generate-task/generate-json'),
   guardSingleProcess = require('../common/generate-task/guard-single-process.js'),
   generateTaskForPrepareWS = require('../common/generate-task/prepare-ws'),
   generateTaskForSaveJoinedMeta = require('../common/generate-task/save-joined-meta'),
   { checkModuleDependenciesExisting } = require('../../lib/check-module-dependencies'),
   generateTaskForTypescriptCompile = require('./generate-task/typescript-compiler'),
   generateTaskForSaveLoggerReport = require('../common/generate-task/save-logger-report'),
   Cache = require('./classes/cache'),
   Configuration = require('./classes/configuration.js'),
   TaskParameters = require('../common/classes/task-parameters'),
   pushChanges = require('../../lib/push-changes');

const {
   generateTaskForLoadCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool
} = require('../common/helpers');

/**
 * Generates a workflow for build of current project static files.
 * @param {string[]} processArgv array of an arguments of running of builder
 * @returns {Undertaker.TaskFunction} gulp task
 */
function generateWorkflow(processArgv) {
   // configuration loading should be synchronous, otherwise tasks queue of current build will not be built
   const config = new Configuration();
   config.loadSync(processArgv);

   const taskParameters = new TaskParameters(
      config,
      new Cache(config),
      config.localizations.length > 0 && config.isReleaseMode
   );

   return gulp.series(

      // generateTaskForLock's first of all
      guardSingleProcess.generateTaskForLock(taskParameters),
      generateTaskForLoadCache(taskParameters),
      generateTaskForMarkThemeModules(taskParameters),

      // generateTaskForClearCache needs loaded cache
      generateTaskForClearCache(taskParameters),

      // WS prepare for worker
      generateTaskForPrepareWS(taskParameters),
      generateTaskForInitWorkerPool(taskParameters),
      generateTaskForGenerateJson(taskParameters),
      generateTaskForTypescriptCompile(taskParameters),
      generateTaskForBuildModules(taskParameters),

      generateTaskForRemoveFiles(taskParameters),
      generateTaskForSaveCache(taskParameters),
      generateTaskForFinalizeDistrib(taskParameters),
      generateTaskForCheckModuleDeps(taskParameters),
      generateTaskForPackHtml(taskParameters),
      generateTaskForCustomPack(taskParameters),
      generateTaskForCompress(taskParameters),
      generateTaskForTerminatePool(taskParameters),
      generateTaskForSaveJoinedMeta(taskParameters),
      generateTaskForSaveLoggerReport(taskParameters),
      generateTaskForSaveTimeReport(taskParameters),
      generateTaskForPushOfChanges(taskParameters),

      // generateTaskForUnlock's after all
      guardSingleProcess.generateTaskForUnlock()
   );
}

function generateTaskForPushOfChanges(taskParameters) {
   if (!taskParameters.config.staticServer) {
      return function skipPushOfChangedFiles(done) {
         done();
      };
   }
   return function pushOfChangedFiles() {
      return pushChanges(taskParameters);
   };
}

function generateTaskForSaveTimeReport(taskParameters) {
   return async function saveTimeReport() {
      const resultJson = [];
      let totalSummary = 0;
      const { tasksTimer } = taskParameters;

      // descending sort of tasks by build time
      const sortedTaskKeys = Object.keys(tasksTimer).sort((a, b) => {
         if (tasksTimer[a].summary > tasksTimer[b].summary) {
            return -1;
         }
         if (tasksTimer[a].summary < tasksTimer[b].summary) {
            return 1;
         }
         return 0;
      });
      const timeFormatter = (duration) => {
         const milliseconds = new Intl.NumberFormat().format((duration % 1000) / 100);
         let
            seconds = Math.floor((duration / 1000) % 60),
            minutes = Math.floor((duration / (1000 * 60)) % 60);

         minutes = (minutes < 10) ? `0${minutes}` : minutes;
         seconds = (seconds < 10) ? `0${seconds}` : seconds;

         return [
            parseInt(minutes, 10) ? `${minutes} m. ` : '',
            parseInt(seconds, 10) ? `${seconds} s. ` : '',
            `${milliseconds} ms.`
         ].join('');
      };
      for (const currentTask of sortedTaskKeys) {
         if (tasksTimer[currentTask].plugins) {
            const currentPlugins = tasksTimer[currentTask].plugins;

            // descending sort of plugins for current task by build time
            const sortedPlugins = Object.keys(currentPlugins).sort((a, b) => {
               if (currentPlugins[a].summary > currentPlugins[b].summary) {
                  return -1;
               }
               if (currentPlugins[a].summary < currentPlugins[b].summary) {
                  return 1;
               }
               return 0;
            });
            resultJson.push({
               Task: currentTask,
               plugin: '-',
               Time: timeFormatter(tasksTimer[currentTask].summary)
            });
            for (const currentPlugin of sortedPlugins) {
               resultJson.push({
                  Task: currentTask,
                  plugin:
                  currentPlugin,
                  Time: timeFormatter(tasksTimer[currentTask].plugins[currentPlugin].summary)
               });
            }
            totalSummary += tasksTimer[currentTask].summary;
         } else {
            resultJson.push({
               Task: currentTask,
               plugin: '-',
               Time: timeFormatter(tasksTimer[currentTask].summary)
            });
            totalSummary += tasksTimer[currentTask].summary;
         }
      }

      // firstly print total summary.
      resultJson.unshift({
         Task: '-',
         plugin: '-',
         Time: timeFormatter(totalSummary)
      });

      // eslint-disable-next-line no-console
      console.table(resultJson);
      await fs.outputJson(`${taskParameters.config.cachePath}/time-report.json`, resultJson);
   };
}

function generateTaskForClearCache(taskParameters) {
   return async function clearCache() {
      const startTime = Date.now();
      await taskParameters.cache.clearCacheIfNeeded(taskParameters.config.getModulesForPatch());
      taskParameters.storeTaskTime('clearCache', startTime);
   };
}

function generateTaskForSaveCache(taskParameters) {
   return async function saveCache() {
      const startTime = Date.now();
      await taskParameters.cache.save();
      taskParameters.storeTaskTime('save cache', startTime);
   };
}

function generateTaskForCheckModuleDeps(taskParameters) {
   if (!taskParameters.config.checkModuleDependencies) {
      return function skipCheckModuleDepsExisting(done) {
         done();
      };
   }
   return async function checkModuleDepsExisting() {
      const startTime = Date.now();
      await checkModuleDependenciesExisting(taskParameters);
      taskParameters.storeTaskTime('module dependencies checker', startTime);
   };
}

module.exports = generateWorkflow;
