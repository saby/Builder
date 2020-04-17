/**
 * Class for module cache
 * @author Kolbeshin F.A.
 */

'use strict';

const helpers = require('../../../lib/helpers');
const path = require('path');
const fs = require('fs-extra');

function setDefaultStore() {
   return {
      componentsInfo: {},
      routesInfo: {},
      markupCache: {},
      esCompileCache: {},
      versionedModules: {},
      cdnModules: {}
   };
}
class ModuleCache {
   constructor(lastStore) {
      this.markupProperties = ['text', 'nodeName', 'dependencies', 'versioned', 'cdnLinked'];
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
            delete object.property;
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
      const prettyPath = helpers.prettifyPath(filePath);
      delete this.currentStore.versionedModules[prettyPath];
   }

   /**
    * Получить все версионированные модули для конкретного Интерфейсного модуля.
    * @returns {Array} Набор файлов, в которые был скомпилирован исходник
    */
   getVersionedModulesCache() {
      return this.currentStore.versionedModules;
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
      const prettyPath = helpers.prettifyPath(filePath);
      delete this.currentStore.cdnModules[prettyPath];
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
   storeComponentInfo(filePath, componentInfo) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (componentInfo) {
         this.currentStore.componentsInfo[prettyPath] = componentInfo;
      }
   }

   storeComponentParameters(filePath, additionalParameters) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (this.currentStore.componentsInfo[prettyPath]) {
         Object.keys(additionalParameters).forEach((currentKey) => {
            this.currentStore.componentsInfo[prettyPath][currentKey] = additionalParameters[currentKey];
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
function generateDownloadModuleCache(taskParameters, moduleInfo) {
   moduleInfo.cachePath = path.join(taskParameters.config.cachePath, 'modules-cache', `${moduleInfo.name}.json`);
   const patchBuild = taskParameters.config.modulesForPatch && taskParameters.config.modulesForPatch.length > 0;
   return async function downloadModuleCache() {
      const lastCache = await getLastModuleCache(moduleInfo.cachePath);
      moduleInfo.cache = new ModuleCache(lastCache);
      if (patchBuild && lastCache) {
         /**
          * in patch for module with rebuild configuration we need to get new themes meta from the
          * last cache value
          * In patch build new themes interface modules may not be participating in patch build,
          * so we can lose meta for this modules.
          */
         if (moduleInfo.rebuild) {
            const currentStoreModulesCache = taskParameters.cache.currentStore;
            const lastStoreModulesCache = taskParameters.cache.lastStore;
            currentStoreModulesCache.themeModules = lastStoreModulesCache.themeModules;
         } else {
            // in patch for modules without rebuild configuration store cache "as is"
            moduleInfo.cache.currentStore = moduleInfo.cache.lastStore;
         }
      }
   };
}

module.exports = generateDownloadModuleCache;
