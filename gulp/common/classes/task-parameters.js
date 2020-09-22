/**
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Класс с базовой информацией для всех gulp задач.
 */
class TaskParameters {
   /**
    * @param {BuildConfiguration|GrabberConfiguration} config конфигурация сборки
    * @param {Cache} cache кеш сборки статики или сборка фраз локализации
    * @param {boolean} needGenerateJson нужна ли генерация json для локализации
    * @param {Pool} pool пул воркеров
    */
   constructor(config, cache, needGenerateJson = false, pool = null) {
      this.config = config;
      this.cache = cache;
      this.pool = pool;
      this.needGenerateJson = needGenerateJson;
      this.currentTask = '';
      this.tasksTimer = {};
      this.filesToRemoveFromOutput = [];
      this.versionedModules = {};
      this.cdnModules = {};
      this.librariesMeta = {};
      this.themedModulesMap = new Map();
   }

   setThemedModule(themedModuleName, originModuleName) {
      this.themedModulesMap.set(themedModuleName, originModuleName);
   }

   /**
    * Установить пул воркеров
    * @param {Pool} pool пул воркеров
    */
   setWorkerPool(pool) {
      this.pool = pool;
   }

   // add summary time of current gulp's plugin working
   storeTaskTime(currentTask, startTime) {
      // calculate overall task worktime
      const summary = startTime ? Date.now() - startTime : 0;
      if (!this.tasksTimer[currentTask]) {
         this.tasksTimer[currentTask] = {
            summary: 0
         };
      }
      this.tasksTimer[currentTask].summary += summary;
   }

   storePluginTime(currentPlugin, startTime, fromWorker) {
      // calculate plugin worktime for current file.
      const summary = fromWorker ? startTime : Date.now() - startTime;
      if (!this.tasksTimer[this.currentTask]) {
         this.tasksTimer[this.currentTask] = {
            plugins: Object.create(null, { summary: { value: 0, writable: true } }),
            summary: 0
         };
      }
      const currentPlugins = this.tasksTimer[this.currentTask].plugins;
      if (!currentPlugins[currentPlugin]) {
         currentPlugins[currentPlugin] = {
            summary: 0
         };
      }
      currentPlugins[currentPlugin].summary += summary;
      currentPlugins.summary += summary;
   }

   setCurrentTask(currentTask) {
      this.currentTask = currentTask;
   }

   normalizePluginsTime() {
      const { plugins, summary } = this.tasksTimer[this.currentTask];

      // normalize work time only for tasks containing inner plugins
      if (plugins) {
         Object.keys(plugins).forEach((currentPlugin) => {
            const currentSummary = plugins[currentPlugin].summary;
            plugins[currentPlugin].summary = (currentSummary / plugins.summary) * summary;
         });
      }
   }

   /**
    * adds file into list to be removed further from output directory
    * to get an actual state of output directory file set after incremental build
    * @param outputPath
    */
   addFileForRemoval(outputPath, isCompressed) {
      this.filesToRemoveFromOutput.push(outputPath);
      if (this.config.compress && isCompressed) {
         this.filesToRemoveFromOutput.push(`${outputPath}.br`);
         this.filesToRemoveFromOutput.push(`${outputPath}.gz`);
      }
   }

   async saveRemovalListMeta() {
      await fs.outputJson(
         path.join(this.config.cachePath, 'output-files-to-remove.json'),
         this.filesToRemoveFromOutput
      );
   }

   setVersionedModules(moduleName, versionedModules) {
      this.versionedModules[moduleName] = versionedModules;
   }

   setCdnModules(moduleName, cdnModules) {
      this.cdnModules[moduleName] = cdnModules;
   }

   filterMeta(moduleName, metaName, filterFunction) {
      this[metaName][moduleName] = this[metaName][moduleName].filter(filterFunction);
   }
}

module.exports = TaskParameters;
