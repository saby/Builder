/**
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   assert = require('assert'),
   pMap = require('p-map'),
   crypto = require('crypto');

const helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate'),
   packageJson = require('../../../package.json'),
   StoreInfo = require('./store-info'),
   logger = require('../../../lib/logger').logger();

/**
 * Класс кеша для реализации инкрементальной сборки.
 * Использует результаты работы предыдущей сборки, чтобы не делать повторную работу.
 */
class Cache {
   constructor(config) {
      this.config = config;
      this.lastStore = new StoreInfo();
      this.currentStore = new StoreInfo();
      this.dropCacheForMarkup = false;
      this.dropCacheForLess = false;
      this.previousRunFailed = false;

      // js и less файлы инвалидируются с зависимостями
      // less - зависмости через import
      // js - зависимости на xhtml и tmpl для кастомной паковки
      this.cacheChanges = {};

      // сохраняем в кеше moduleDependencies для быстрого доступа в паковке, чтобы не читать файлы
      this.moduleDependencies = {
         links: {},
         nodes: {},
         packedLibraries: {},
         lessDependencies: {}
      };
   }

   async load(patchBuild) {
      await this.lastStore.load(this.config.cachePath);
      this.currentStore.runningParameters = this.config.rawConfig;
      this.currentStore.versionOfBuilder = packageJson.version;
      this.currentStore.startBuildTime = new Date().getTime();
      for (const moduleInfo of this.config.modules) {
         // in patch for module without rebuild configuration copy builder cache as is if it exists
         if (patchBuild && !moduleInfo.rebuild && this.lastStore.modulesCache[moduleInfo.name]) {
            this.currentStore.modulesCache[moduleInfo.name] = this.lastStore.modulesCache[moduleInfo.name];
            this.currentStore.inputPaths[moduleInfo.path] = this.lastStore.inputPaths[moduleInfo.path];
         } else {
            this.currentStore.modulesCache[moduleInfo.name] = {
               componentsInfo: {},
               routesInfo: {},
               markupCache: {},
               esCompileCache: {},
               versionedModules: {},
               cdnModules: {},
               lessConfig: ''
            };
            this.currentStore.inputPaths[moduleInfo.path] = {
               hash: '',
               output: []
            };
         }
      }
   }

   save(modulesForPatch) {
      return this.currentStore.save(this.config.cachePath, modulesForPatch);
   }

   /**
    * Проверяет есть ли несовместимые изменения в проекте, из-за которых нужно очистить кеш.
    * @returns {Promise<boolean>}
    */
   async cacheHasIncompatibleChanges(patchBuild) {
      // for patch skip configuration checker
      if (patchBuild) {
         return false;
      }
      const finishText = 'Кеш и результат предыдущей сборки будут удалены, если существуют.';
      if (this.previousRunFailed) {
         logger.info(`В директории кэша с предыдущей сборки остался файл builder.lockfile. ${finishText}`);
         return true;
      }
      if (this.lastStore.versionOfBuilder === 'unknown') {
         logger.info(`Не удалось обнаружить валидный кеш от предыдущей сборки. ${finishText}`);
         return true;
      }
      if (this.lastStore.runningParameters.criticalErrors) {
         logger.info(`Предыдущий билд завершился с критическими ошибками. ${finishText}`);
         return true;
      }
      const lastRunningParameters = { ...this.lastStore.runningParameters };
      const currentRunningParameters = { ...this.currentStore.runningParameters };

      // поле version всегда разное
      if (lastRunningParameters.version !== '' || currentRunningParameters.version !== '') {
         if (lastRunningParameters.version === '' || currentRunningParameters.version === '') {
            logger.info(`Параметры запуска builder'а поменялись. ${finishText}`);
            return true;
         }
         lastRunningParameters.version = '';
         currentRunningParameters.version = '';
      }
      try {
         assert.deepStrictEqual(lastRunningParameters, currentRunningParameters);
      } catch (error) {
         logger.info(`Параметры запуска builder'а поменялись. ${finishText}`);
         return true;
      }

      // новая версия билдера может быть полностью не совместима
      const isNewBuilder = this.lastStore.versionOfBuilder !== this.currentStore.versionOfBuilder;
      if (isNewBuilder) {
         logger.info(`Версия builder'а не соответствует сохранённому значению в кеше. ${finishText}`);
         return true;
      }

      // если нет хотя бы одной папки не оказалось на месте, нужно сбросить кеш
      const promisesExists = [];
      for (const moduleInfo of this.config.modules) {
         promisesExists.push(fs.pathExists(moduleInfo.output));
      }
      const resultsExists = await Promise.all(promisesExists);
      if (resultsExists.includes(false)) {
         logger.info(`Как минимум один из результирующих каталогов был удалён. ${finishText}`);
         return true;
      }
      return false;
   }

   /**
    * Чистит кеш, если инкрементальная сборка невозможна.
    */
   async clearCacheIfNeeded(patchBuild) {
      const removePromises = [];
      if (await this.cacheHasIncompatibleChanges(patchBuild)) {
         this.lastStore = new StoreInfo();

         // из кеша можно удалить всё кроме .lockfile
         if (await fs.pathExists(this.config.cachePath)) {
            for (const fullPath of await fs.readdir(this.config.cachePath)) {
               if (!fullPath.endsWith('.lockfile')) {
                  removePromises.push(fs.remove(fullPath));
               }
            }
         }
         if (await fs.pathExists(this.config.outputPath) && !this.config.isSourcesOutput && this.config.clearOutput) {
            removePromises.push(fs.remove(this.config.outputPath));
         }
      }

      // если собираем дистрибутив, то config.rawConfig.output нужно всегда очищать
      if (
         this.config.outputPath !== this.config.rawConfig.output &&
         !this.config.isSourcesOutput &&
         this.config.clearOutput
      ) {
         if (await fs.pathExists(this.config.rawConfig.output)) {
            removePromises.push(fs.remove(this.config.rawConfig.output));
         }
      }
      if (removePromises.length > 0) {
         logger.info('Запускается очистка кэша');
      }
      await Promise.all(removePromises);
      if (removePromises.length > 0) {
         logger.info('Очистка кэша завершена');
      }
   }

   /**
    * Проверяет нужно ли заново обрабатывать файл или можно ничего не делать.
    * @param {string} filePath путь до файла
    * @param {Buffer} fileContents содержимое файла
    * @param {ModuleInfo} moduleInfo информация о модуле.
    * @returns {Promise<boolean>}
    */
   async isFileChanged(filePath, fileContents, moduleInfo) {
      const prettyPath = helpers.prettifyPath(filePath);
      let hash = '';
      if (fileContents) {
         hash = crypto
            .createHash('sha1')
            .update(fileContents)
            .digest('base64');
      }
      const isChanged = await this._isFileChanged(prettyPath, hash, moduleInfo);

      const relativePath = path.relative(moduleInfo.path, filePath);
      const outputFullPath = path.join(moduleInfo.output, transliterate(relativePath));
      this.currentStore.inputPaths[prettyPath] = {
         hash,
         output: [helpers.prettifyPath(outputFullPath)]
      };

      if (!isChanged) {
         // вытащим данные из старого кеша в новый кеш
         const lastModuleCache = this.lastStore.modulesCache[moduleInfo.name];
         const currentModuleCache = this.currentStore.modulesCache[moduleInfo.name];
         if (lastModuleCache.componentsInfo.hasOwnProperty(prettyPath)) {
            currentModuleCache.componentsInfo[prettyPath] = lastModuleCache.componentsInfo[prettyPath];
         }
         if (lastModuleCache.markupCache.hasOwnProperty(prettyPath)) {
            currentModuleCache.markupCache[prettyPath] = lastModuleCache.markupCache[prettyPath];
         }
         if (lastModuleCache.esCompileCache.hasOwnProperty(prettyPath)) {
            currentModuleCache.esCompileCache[prettyPath] = lastModuleCache.esCompileCache[prettyPath];
         }
         if (lastModuleCache.routesInfo.hasOwnProperty(prettyPath)) {
            currentModuleCache.routesInfo[prettyPath] = lastModuleCache.routesInfo[prettyPath];
         }
         if (lastModuleCache.versionedModules.hasOwnProperty(prettyPath)) {
            currentModuleCache.versionedModules[prettyPath] = lastModuleCache.versionedModules[prettyPath];
         }
         if (path.basename(prettyPath) === 'themes.config.json' && !currentModuleCache.lessConfig) {
            currentModuleCache.lessConfig = lastModuleCache.lessConfig;
         }
         if (lastModuleCache.cdnModules.hasOwnProperty(prettyPath)) {
            currentModuleCache.cdnModules[prettyPath] = lastModuleCache.cdnModules[prettyPath];
         }
         if (this.lastStore.dependencies.hasOwnProperty(prettyPath)) {
            this.currentStore.dependencies[prettyPath] = this.lastStore.dependencies[prettyPath];
         }
      }

      return isChanged;
   }

   async _isFileChanged(prettyPath, hash) {
      // кеша не было, значит все файлы новые
      if (!this.lastStore.startBuildTime) {
         return true;
      }

      // если сборка с локализацией и свойства компонентов поменялись
      if (this.dropCacheForMarkup && (prettyPath.endsWith('.xhtml') || prettyPath.endsWith('.tmpl'))) {
         return true;
      }

      // если список тем поменялся, то нужно все less пересобрать
      if (this.dropCacheForLess && (prettyPath.endsWith('.less'))) {
         return true;
      }

      // новый файл
      if (!this.lastStore.inputPaths.hasOwnProperty(prettyPath)) {
         return true;
      }

      // файл с ошибкой
      if (this.lastStore.filesWithErrors.has(prettyPath)) {
         return true;
      }

      if (this.lastStore.inputPaths[prettyPath].hash !== hash) {
         if (prettyPath.endsWith('.less') || prettyPath.endsWith('.js') || prettyPath.endsWith('.es') || prettyPath.endsWith('.ts')) {
            this.cacheChanges[prettyPath] = true;
         }
         return true;
      }

      // если локализуемые стили задаются через less,
      // то при инкрементальной сборке в lang/en-US/en-US.js не попадает информация о стилях.
      // TODO: Организовать кеширование локализуемых less файлов по задаче:
      // https://online.sbis.ru/opendoc.html?guid=7f4d01c5-32f0-4e80-8e7e-4e891e21c830
      if (path.basename(prettyPath) === 'en-US.less') {
         return true;
      }

      if (prettyPath.endsWith('.less') || prettyPath.endsWith('.js') || prettyPath.endsWith('.es') || prettyPath.endsWith('.ts')) {
         const isChanged = await this._isDependenciesChanged(prettyPath);
         this.cacheChanges[prettyPath] = isChanged;
         return isChanged;
      }

      return false;
   }

   /**
    * Добавляет в кеш информацию о дополнительных генерируемых файлах.
    * Это нужно, чтобы в финале инкрементальной сборки удалить только не актуальные файлы.
    * @param {string} filePath путь до файла
    * @param {string} outputFilePath путь до генерируемого файла.
    * @param {ModuleInfo} moduleInfo информация о модуле.
    */
   addOutputFile(filePath, outputFilePath, moduleInfo) {
      const prettyFilePath = helpers.prettifyPath(filePath);
      const outputPrettyPath = helpers.prettifyPath(outputFilePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyFilePath)) {
         this.currentStore.inputPaths[prettyFilePath].output.push(outputPrettyPath);
      } else {
         // некоторые файлы являются производными от всего модуля. например en-US.js, en-US.css
         this.currentStore.inputPaths[moduleInfo.path].output.push(outputPrettyPath);
      }
   }

   getOutputForFile(filePath) {
      const prettyFilePath = helpers.prettifyPath(filePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyFilePath)) {
         return this.currentStore.inputPaths[prettyFilePath].output;
      }
      return [];
   }

   /**
    * Получить список файлов из исходников, которые относятся к конкретному модулю
    * @param {string} modulePath путь до модуля
    * @returns {string[]}
    */
   getInputPathsByFolder(modulePath) {
      const prettyModulePath = helpers.prettifyPath(modulePath);
      return Object.keys(this.currentStore.inputPaths).filter(filePath => filePath.startsWith(prettyModulePath));
   }

   /**
    * Пометить файл как ошибочный, чтобы при инкрементальной сборке обработать его заново.
    * Что-то могло поменятся. Например, в less может поменятся файл, который импортируем.
    * @param {string} filePath путь до исходного файла
    */
   markFileAsFailed(filePath) {
      const prettyPath = helpers.prettifyPath(filePath);
      this.currentStore.filesWithErrors.add(prettyPath);
   }

   markCacheAsFailed() {
      this.currentStore.runningParameters.criticalErrors = true;
   }

   /**
    * Добавить информацию о зависимостях файла. Это нужно для инкрементальной сборки, чтобы
    * при изменении файла обрабатывать другие файлы, которые зависят от текущего.
    * @param {string} filePath путь до исходного файла
    * @param {string} imports список зависимостей (пути до исходников)
    */
   addDependencies(filePath, imports) {
      const prettyPath = helpers.prettifyPath(filePath);
      this.currentStore.dependencies[prettyPath] = imports.map(helpers.prettifyPath);
   }

   getDependencies(filePath) {
      const prettyPath = helpers.prettifyPath(filePath);
      return this.currentStore.dependencies[prettyPath] || [];
   }

   /**
    * Проверить изменились ли зависимости текущего файла
    * @param {string} filePath путь до файла
    * @returns {Promise<boolean>}
    */
   async _isDependenciesChanged(filePath) {
      const dependencies = this.getAllDependencies(filePath);
      if (dependencies.length === 0) {
         return false;
      }
      const listChangedDeps = await pMap(
         dependencies,
         async(currentPath) => {
            if (this.cacheChanges.hasOwnProperty(currentPath)) {
               return this.cacheChanges[currentPath];
            }
            if (
               !this.lastStore.inputPaths.hasOwnProperty(currentPath) ||
               !this.lastStore.inputPaths[currentPath].hash
            ) {
               return true;
            }
            let isChanged = false;
            if (await fs.pathExists(currentPath)) {
               const fileContents = await fs.readFile(currentPath);
               const hash = crypto
                  .createHash('sha1')
                  .update(fileContents)
                  .digest('base64');
               isChanged = this.lastStore.inputPaths[currentPath].hash !== hash;
            } else {
               isChanged = true;
            }
            this.cacheChanges[currentPath] = isChanged;
            return isChanged;
         },
         {
            concurrency: 20
         }
      );
      return listChangedDeps.some(changed => changed);
   }

   /**
    * Получить все зависмости файла
    * @param {string} filePath путь до файла
    * @returns {string[]}
    */
   getAllDependencies(filePath) {
      const prettyPath = helpers.prettifyPath(filePath);
      const results = new Set();
      const queue = [prettyPath];

      while (queue.length > 0) {
         const currentPath = queue.pop();
         if (this.lastStore.dependencies.hasOwnProperty(currentPath)) {
            for (const dependency of this.lastStore.dependencies[currentPath]) {
               if (!results.has(dependency)) {
                  results.add(dependency);
                  queue.push(dependency);
               }
            }
         }
      }
      return Array.from(results);
   }

   /**
    * Сохранить информацию о js компоненте после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {string} moduleName имя модуля, в котором расположен файл
    * @param {Object} componentInfo объект с информацией о компоненте
    */
   storeComponentInfo(filePath, moduleName, componentInfo) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (!componentInfo) {
         // если парсер упал на файле, то нужно выкинуть файл из inputPaths,
         // чтобы ошибка повторилась при повторном запуске
         if (this.currentStore.inputPaths.hasOwnProperty(prettyPath)) {
            delete this.currentStore.inputPaths[prettyPath];
         }
      } else {
         const currentModuleCache = this.currentStore.modulesCache[moduleName];
         currentModuleCache.componentsInfo[prettyPath] = componentInfo;
      }
   }

   /**
    * Получить информацию о JS компонентах модуля
    * @param {string} moduleName имя модуля
    * @returns {Object<string,Object>} Информация о JS компонентах модуля в виде
    *    {
    *       <путь до файла>: <информация о компоненте>
    *    }
    */
   getComponentsInfo(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.componentsInfo;
   }

   /**
    * Сохранить в кеше скомпилированную верстку xhtml или tmpl. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeBuildedMarkup(filePath, moduleName, obj) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      currentModuleCache.markupCache[prettyPath] = obj;
   }

   /**
    * Сохранить в кеше скомпилированный ES-модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {Object} obj Объект с полями text, nodeName (имя файла для require) и dependencies
    */
   storeCompiledES(filePath, moduleName, obj) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      currentModuleCache.esCompileCache[prettyPath] = obj;
   }

   /**
    * Сохранить в кеше версионированный модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   storeVersionedModule(filePath, moduleName, outputName) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      if (!currentModuleCache.versionedModules.hasOwnProperty(prettyPath)) {
         currentModuleCache.versionedModules[prettyPath] = [];
      }
      if (!currentModuleCache.versionedModules[prettyPath].includes(outputName)) {
         currentModuleCache.versionedModules[prettyPath].push(outputName);
      }
   }

   /**
    * Удалить из кэша версионированный модуль. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   removeVersionedModule(filePath, moduleName) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      delete currentModuleCache.versionedModules[prettyPath];
   }


   /**
    * Сохранить в кэше конфигурацию сборки less для данного Интерфейсного
    * модуля
    * @param{String} moduleName - название Интерфейсного модуля
    * @param config
    */
   addModuleLessConfiguration(moduleName, config) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      currentModuleCache.lessConfig = config;
   }

   /**
    * Получить из кэша конфигурацию сборки less для данного Интерфейсного
    * модуля
    * @param{String} moduleName - название Интерфейсного модуля
    * @returns {*}
    */
   getModuleLessConfiguration(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.lessConfig;
   }

   /**
    * Сохранить в кеше модуль, содержащий линки на cdn. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   storeCdnModule(filePath, moduleName, outputName) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      if (!currentModuleCache.cdnModules.hasOwnProperty(prettyPath)) {
         currentModuleCache.cdnModules[prettyPath] = [];
      }
      if (!currentModuleCache.cdnModules[prettyPath].includes(outputName)) {
         currentModuleCache.cdnModules[prettyPath].push(outputName);
      }
   }

   /**
    * Удалить из кэша модуль, содержащий линки на cdn. Для инкрементальной сборки.
    * @param {string} filePath имя файла
    * @param {string} moduleName имя модуля
    * @param {string} outputName результат работы сборщика для файла
    * @param {Object}
    */
   removeCdnModule(filePath, moduleName) {
      const prettyPath = helpers.prettifyPath(filePath);
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      delete currentModuleCache.cdnModules[prettyPath];
   }

   /**
    * Получить всю скомпилированную верстку для конкретного модуля
    * @param {string} moduleName имя модуля
    * @returns {Object} Информация о скомпилированной верстки модуля в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>,
    *          dependencies: [...<зависимости>]
    *       }
    *    }
    */
   getMarkupCache(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.markupCache;
   }

   /**
    * Получить все скомпилированные ES модули для конкретного интерфейсного модуля.
    * @param {string} moduleName имя модуля
    * @returns {Object} Информация о скомпилированном ES модуле в виде
    *    {
    *       <путь до файла>: {
    *          text: <js код>
    *          nodeName: <имя файла для require>
    *       }
    *    }
    */
   getCompiledEsModuleCache(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.esCompileCache;
   }

   /**
    * Получить все версионированные модули для конкретного Интерфейсного модуля.
    * @param {string} moduleName имя модуля
    * @returns {Array} Набор файлов, в которые был скомпилирован исходник
    */
   getVersionedModulesCache(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.versionedModules;
   }

   getCdnModulesCache(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.cdnModules;
   }

   /**
    * Сохранить информацию о роутинге после парсинга для использования в повторной сборке.
    * @param {string} filePath путь до файла
    * @param {string} moduleName имя модуля
    * @param {Object} routeInfo объект с информацией о роутинге
    */
   storeRouteInfo(filePath, moduleName, routeInfo) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (!routeInfo) {
         // если парсер упал на файле, то нужно выкинуть файл из inputPaths,
         // чтобы ошибка повторилась при повторном запуске
         if (this.currentStore.inputPaths.hasOwnProperty(prettyPath)) {
            delete this.currentStore.inputPaths[prettyPath];
         }
      } else {
         const currentModuleCache = this.currentStore.modulesCache[moduleName];
         currentModuleCache.routesInfo[prettyPath] = routeInfo;
      }
   }

   /**
    * Получить всю информацию о роутингах для конкретного модуля
    * @param {string} moduleName имя модуля
    * @returns {Object} Информация о роутингах модуля в виде
    *    {
    *       <путь до файла>: {...<роунги файла>}
    *    }
    */
   getRoutesInfo(moduleName) {
      const currentModuleCache = this.currentStore.modulesCache[moduleName];
      return currentModuleCache.routesInfo;
   }

   /**
    * Получить список файлов, которые нужно удалить из целевой директории после инкрементальной сборки
    * @returns {Promise<string[]>}
    */
   async getListForRemoveFromOutputDir() {
      const currentOutputSet = this.currentStore.getOutputFilesSet();
      const lastOutputSet = this.lastStore.getOutputFilesSet();
      const removeFiles = Array.from(lastOutputSet).filter(filePath => !currentOutputSet.has(filePath));

      const results = await pMap(
         removeFiles,
         async(filePath) => {
            let needRemove = false;
            let stat = null;
            try {
               // fs.access и fs.pathExists не правильно работают с битым симлинками
               // поэтому сразу используем fs.lstat
               stat = await fs.lstat(filePath);
            } catch (e) {
               // ничего нелать не нужно
            }

            // если файл не менялся в текущей сборке, то его нужно удалить
            // файл может менятся в случае если это, например, пакет из нескольких файлов
            if (stat) {
               needRemove = stat.mtime.getTime() < this.currentStore.startBuildTime;
            }

            return {
               filePath,
               needRemove
            };
         },
         {
            concurrency: 20
         }
      );
      return results
         .map((obj) => {
            if (obj.needRemove) {
               return obj.filePath;
            }
            return null;
         })
         .filter(filePath => !!filePath);
   }

   addStyleTheme(themeName, filePath, themeConfig) {
      this.currentStore.styleThemes[themeName] = {
         path: filePath,
         config: themeConfig
      };
   }

   checkThemesForUpdate() {
      try {
         assert.deepStrictEqual(this.currentStore.styleThemes, this.lastStore.styleThemes);
      } catch (error) {
         this.dropCacheForLess = true;
      }
   }

   /**
    * Установить признак того, что верстку нужно скомпилировать заново.
    * Это случается, если включена локализация и какой-либо класс в jsdoc поменялся.
    */
   setDropCacheForMarkup() {
      this.dropCacheForMarkup = true;
   }

   /**
    * Сохраняем moduleDependencies конкретного модуля в общий для проекта moduleDependencies
    * @param {{links: {}, nodes: {}, packedLibraries: {}}} obj Объект moduleDependencies конкретного модуля
    */
   storeLocalModuleDependencies(obj) {
      this.moduleDependencies = {
         links: { ...this.moduleDependencies.links, ...obj.links },
         nodes: { ...this.moduleDependencies.nodes, ...obj.nodes },
         packedLibraries: { ...this.moduleDependencies.packedLibraries, ...obj.packedLibraries },
      };
   }

   /**
    * Получить общий для проекта moduleDependencies
    * @returns {{links: {}, nodes: {}}}
    */
   getModuleDependencies() {
      return this.moduleDependencies;
   }
}

module.exports = Cache;
