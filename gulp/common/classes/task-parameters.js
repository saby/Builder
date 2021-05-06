/**
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const { unixifyPath } = require('../../../lib/helpers');

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
      this.changedModules = new Set();
      this.themedModulesMap = new Map();
      this.lazyBundles = {};
      this.lazyBundlesMap = {};
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

   addChangedFile(fileName) {
      this.changedModules.add(fileName);
   }

   removeChangedFile(fileName) {
      this.changedModules.delete(fileName);
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
      const prettyOutputPath = unixifyPath(outputPath);
      this.filesToRemoveFromOutput.push(prettyOutputPath);
      if (this.config.compress && isCompressed) {
         this.filesToRemoveFromOutput.push(`${prettyOutputPath}.br`);
         this.filesToRemoveFromOutput.push(`${prettyOutputPath}.gz`);
      }
   }

   addLazyBundle(bundleName, externalDependencies, internalDependencies) {
      this.lazyBundles[bundleName] = {
         externalDependencies,
         internalModules: []
      };
      for (const module of internalDependencies.keys()) {
         if (this.lazyBundlesMap.hasOwnProperty(module)) {
            throw new Error(`Attempt to pack module ${module} from lazy package ${this.lazyBundlesMap[module]} to another lazy package`);
         } else {
            this.lazyBundlesMap[module] = bundleName;
            this.lazyBundles[bundleName].internalModules.push(module);
         }
      }
   }

   /**
    * recursively checks cyclic dependencies between external dependencies of lazy bundle and it's internal modules
    * @param dependencies
    * @param internalModules
    * @param currentModule
    * @param currentSequence
    * @returns {{sequence: [], cyclic: boolean}}
    */
   recursiveChecker(cyclicSequences, dependencies, internalModules, currentModule, currentSequence) {
      // catch all cyclic dependencies even if it's a cycle between 2 external dependencies of current lazy package
      if (currentSequence.includes(currentModule)) {
         currentSequence.push(currentModule);
         cyclicSequences.push(currentSequence);
         return currentSequence;
      }
      currentSequence.push(currentModule);

      // if current module creates cycle dependency, mark current sequence as cyclic
      // and return a result to log it properly to understand what happened
      if (
         currentSequence.length > 1 && internalModules.includes(currentModule)
      ) {
         cyclicSequences.push(currentSequence);
         return currentSequence;
      }
      const currentDependencies = dependencies[currentModule];
      if (currentDependencies) {
         currentDependencies.forEach((currentDependency) => {
            const newSequence = [...currentSequence];
            this.recursiveChecker(
               cyclicSequences,
               dependencies,
               internalModules,
               currentDependency,
               newSequence
            );
         });
      }
      return currentSequence;
   }

   checkLazyBundlesForCycles(dependencies) {
      const cyclicSequences = {};
      Object.keys(this.lazyBundles).forEach((currentLazyBundleName) => {
         const currentLazyBundle = this.lazyBundles[currentLazyBundleName];
         const result = [];

         // store external dependencies of bundle as dependencies of each lazy package internal module
         // to catch an issue when one lazy package has a cycle from another lazy package.
         this.lazyBundles[currentLazyBundleName].internalModules.forEach((currentInternalModule) => {
            if (dependencies[currentInternalModule]) {
               dependencies[`${currentInternalModule}_old`] = dependencies[currentInternalModule];
               const normalizedModuleDependencies = this.lazyBundles[currentLazyBundleName].externalDependencies;
               dependencies[currentInternalModule] = [currentLazyBundleName];
               dependencies[currentLazyBundleName] = normalizedModuleDependencies;
            }
         });
         currentLazyBundle.externalDependencies.forEach((externalDependency) => {
            this.recursiveChecker(
               result,
               dependencies,
               currentLazyBundle.internalModules,
               externalDependency,
               []
            );
         });
         if (result.length > 0) {
            cyclicSequences[currentLazyBundleName] = [];
            result.forEach((currentCycle) => {
               const externalEntryPoint = currentCycle[0];
               const dependingInternalModules = currentLazyBundle.internalModules.filter(
                  currentInternalModule => dependencies[currentInternalModule] &&
                     (dependencies[currentInternalModule].includes(externalEntryPoint) ||
                        dependencies[`${currentInternalModule}_old`].includes(externalEntryPoint))
               );

               // add internal module entry point to have an understanding which internal module
               // exactly have an external dependency that creates a cycle between the dependency and
               // another internal module of current lazy package
               dependingInternalModules.forEach(
                  currentInternalModule => cyclicSequences[currentLazyBundleName].push(
                     [currentInternalModule, ...currentCycle]
                  )
               );
            });
         }
      });
      return cyclicSequences;
   }

   async saveLazyBundles() {
      await fs.outputJson(
         path.join(this.config.cachePath, 'lazy-bundles.json'),
         this.lazyBundles
      );
   }

   async saveLazyBundlesMap() {
      await fs.outputJson(
         path.join(this.config.cachePath, 'lazy-bundles-map.json'),
         this.lazyBundlesMap
      );
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
