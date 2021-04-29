/**
 * Class for module cache
 * @author Kolbeshin F.A.
 */

'use strict';

const helpers = require('../../../lib/helpers');
const { FILE_CONTENTS_CACHE, COMMON_CACHE_PROPERTIES } = require('../../../lib/builder-cache-constants');
const path = require('path');
const fs = require('fs-extra');

const CACHE_PROPERTIES = new Set([...FILE_CONTENTS_CACHE, ...COMMON_CACHE_PROPERTIES]);

/**
 * fills store with missing cache properties
 * needed for compatibility with previous builds if
 * there is new type of cache in new builder added.
 */
function fillRemainingProperties(store) {
   if (store) {
      CACHE_PROPERTIES.forEach((currentProperty) => {
         if (!store.hasOwnProperty(currentProperty)) {
            store[currentProperty] = {};
         }
      });
   }
}

function setDefaultStore() {
   const result = {};
   CACHE_PROPERTIES.forEach((currentProperty) => {
      result[currentProperty] = {};
   });
   return result;
}

function getSvgCacheByStore(svgCache) {
   const result = {};
   Object.keys(svgCache).forEach((currentSvg) => {
      const svgPathParts = currentSvg.split('/');
      if (svgPathParts.length >= 3) {
         // get svg package name as a 1 level directory of icons
         const packageName = svgPathParts[1];
         if (!result[packageName]) {
            result[packageName] = [{
               path: currentSvg,
               content: svgCache[currentSvg]
            }];
         } else {
            result[packageName].push({
               path: currentSvg,
               content: svgCache[currentSvg]
            });
         }
      }
   });
   return result;
}

class ModuleCache {
   constructor(lastStore) {
      this.markupProperties = ['text', 'nodeName', 'dependencies', 'versioned', 'cdnLinked'];

      fillRemainingProperties(lastStore);
      this.lastStore = lastStore || setDefaultStore();
      this.currentStore = setDefaultStore();
   }

   /**
    * removes all properties have been transmitted from templates processor but there is
    * no further need of them in builder's cache.
    * @param object
    */
   removeUnnededProperties(object) {
      for (const property in object) {
         if (object.hasOwnProperty(property) && !this.markupProperties.includes(property)) {
            delete object[property];
         }
      }
   }

   /**
    * Получить информацию о JS компонентах модуля
    * @returns {Object<string,Object>} Информация о JS компонентах модуля в виде
    *    {
    *       <путь до файла>: <информация о компоненте>
    *    }
    */
   getComponentsInfo() {
      return this.currentStore.componentsInfo;
   }

   /**
    * Get full info about current component from cache storage
    * @param filePath - full path to file
    * @returns {*}
    */
   getCurrentComponentInfo(relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      return this.currentStore.componentsInfo[prettyRelativePath];
   }

   /**
    * Сохранить в кеше скомпилированную верстку xhtml или tmpl. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeBuildedMarkup(filePath, obj) {
      const prettyPath = helpers.prettifyPath(filePath);
      this.removeUnnededProperties(obj);
      this.currentStore.markupCache[prettyPath] = obj;
   }

   /**
    * Сохранить в кеше скомпилированный ES-модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeCompiledES(filePath, obj) {
      const prettyPath = helpers.prettifyPath(filePath);
      this.currentStore.esCompileCache[prettyPath] = obj;
   }

   storeSvgContent(relativePath, content) {
      const prettyPath = helpers.unixifyPath(relativePath);
      this.currentStore.svgCache[prettyPath] = content;
   }

   getCurrentSvgPackagesMeta() {
      const { svgCache } = this.currentStore;
      return getSvgCacheByStore(svgCache);
   }

   getLastSvgPackagesMeta() {
      const { svgCache } = this.lastStore;
      return getSvgCacheByStore(svgCache);
   }

   /**
    * Сохранить в кеше версионированный модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   storeVersionedModule(filePath, outputName) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (!this.currentStore.versionedModules.hasOwnProperty(prettyPath)) {
         this.currentStore.versionedModules[prettyPath] = [];
      }
      if (!this.currentStore.versionedModules[prettyPath].includes(outputName)) {
         this.currentStore.versionedModules[prettyPath].push(outputName);
      }
   }

   /**
    * Удалить из кэша версионированный модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    */
   removeVersionedModule(filePath) {
      delete this.currentStore.versionedModules[filePath];
   }

   /**
    * Получить все версионированные модули для конкретного Интерфейсного модуля.
    * @returns {Array} Набор файлов, в которые был скомпилирован исходник
    */
   getVersionedModulesCache() {
      return this.currentStore.versionedModules;
   }

   migrateCurrentFileCache(currentPath) {
      const prettyPath = helpers.unixifyPath(currentPath);
      CACHE_PROPERTIES.forEach((currentProperty) => {
         if (this.lastStore[currentProperty].hasOwnProperty(prettyPath)) {
            this.currentStore[currentProperty][prettyPath] = this.lastStore[currentProperty][prettyPath];
         }
      });
   }

   /**
    * Сохранить в кеше модуль, содержащий линки на cdn. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   storeCdnModule(filePath, outputName) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (!this.currentStore.cdnModules.hasOwnProperty(prettyPath)) {
         this.currentStore.cdnModules[prettyPath] = [];
      }
      if (!this.currentStore.cdnModules[prettyPath].includes(outputName)) {
         this.currentStore.cdnModules[prettyPath].push(outputName);
      }
   }

   /**
    * Удалить из кэша модуль, содержащий линки на cdn. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   removeCdnModule(filePath) {
      delete this.currentStore.cdnModules[filePath];
   }

   /**
    * Получить всю скомпилированную верстку для конкретного модуля
    * @returns {Object} Информация о скомпилированной верстки модуля в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>,
    *          dependencies: [...<зависимости>]
    *       }
    *    }
    */
   getMarkupCache() {
      return this.currentStore.markupCache;
   }

   /**
    * Получить все скомпилированные ES модули для конкретного интерфейсного модуля.
    * @returns {Object} Информация о скомпилированном ES модуле в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>
    *       }
    *    }
    */
   getCompiledEsModuleCache() {
      return this.currentStore.esCompileCache;
   }

   getCdnModulesCache() {
      return this.currentStore.cdnModules;
   }

   /**
    * Получить всю информацию о роутингах для конкретного модуля
    * @returns {Object} Информация о роутингах модуля в виде
    *    {
    *       <путь до файла>: {...<роунги файла>}
    *    }
    */
   getRoutesInfo() {
      return this.currentStore.routesInfo;
   }

   /**
    * Сохранить информацию о js компоненте после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {Object} componentInfo объект с информацией о компоненте
    */
   storeComponentInfo(relativePath, componentInfo) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      if (componentInfo) {
         this.currentStore.componentsInfo[prettyRelativePath] = componentInfo;
      }
   }

   storeComponentParameters(relativePath, additionalParameters) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      if (this.currentStore.componentsInfo[prettyRelativePath]) {
         Object.keys(additionalParameters).forEach((currentKey) => {
            this.currentStore.componentsInfo[prettyRelativePath][currentKey] = additionalParameters[currentKey];
         });
      }
   }

   /**
    * Сохранить информацию о роутинге после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {Object} routeInfo объект с информацией о роутинге
    */
   storeRouteInfo(filePath, routeInfo) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (routeInfo) {
         this.currentStore.routesInfo[prettyPath] = routeInfo;
      }
   }

   setLastStore(lastStore) {
      this.lastStore = lastStore;
   }
}

/**
 * Read cache from disk if it exists
 * @param moduleCachePath - path to current cache
 * @returns {Promise<null>}
 */
async function getLastModuleCache(moduleCachePath) {
   if (await fs.pathExists(moduleCachePath)) {
      const result = await fs.readJson(moduleCachePath);
      return result;
   }
   return null;
}

/**
 * Task for getting saved module cache from disk if needed
 * @param taskParameters - whole parameters list of current project build
 * @param moduleInfo - main info about current module
 * @returns {downloadModuleCache}
 */
function generateDownloadModuleCache(taskParameters, moduleInfo, singleFileBuild) {
   moduleInfo.cachePath = path.join(taskParameters.config.cachePath, 'modules-cache', `${moduleInfo.name}.json`);

   // If it's a single file build(simple watcher) or patch build
   // a whole module cache should be loaded instantaneously
   const patchBuild = singleFileBuild ||
      (taskParameters.config.modulesForPatch && taskParameters.config.modulesForPatch.length > 0);
   return async function downloadModuleCache() {
      const lastCache = await getLastModuleCache(moduleInfo.cachePath);
      moduleInfo.cache = new ModuleCache(lastCache);
      if (patchBuild && lastCache && !moduleInfo.rebuild) {
         // in patch for modules without rebuild configuration store cache "as is"
         moduleInfo.cache.currentStore = moduleInfo.cache.lastStore;
      }
      if (moduleInfo.changedFiles) {
         taskParameters.cache.migrateNotChangedFiles(moduleInfo);
      }
   };
}

/**
 * Task for saving current module cache on disk
 * @param moduleInfo - main info about current module
 * @returns {saveModuleCache}
 */
function generateSaveModuleCache(moduleInfo) {
   return async function saveModuleCache() {
      await fs.outputJson(moduleInfo.cachePath, moduleInfo.cache.currentStore);
      delete moduleInfo.cache;
   };
}

module.exports = {
   generateDownloadModuleCache,
   generateSaveModuleCache
};
