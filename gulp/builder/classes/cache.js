/**
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   assert = require('assert'),
   pMap = require('p-map'),
   crypto = require('crypto');

const helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate'),
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

   // setting default store values for current interface module
   setDefaultStore(moduleInfo) {
      this.currentStore.inputPaths[moduleInfo.path] = {
         hash: '',
         output: []
      };
   }

   async load(patchBuild) {
      await this.lastStore.load(this.config.cachePath);

      /**
       * in UI patch build we need to get cached "module-dependencies" meta to make custom packing
       * works properly
       */
      const cachedModuleDependencies = path.join(this.config.cachePath, 'module-dependencies.json');
      if (patchBuild && await fs.pathExists(cachedModuleDependencies)) {
         this.moduleDependencies = await fs.readJson(cachedModuleDependencies);
      }
      this.currentStore.runningParameters = this.config.rawConfig;

      // read current builder hash from root of builder.
      this.currentStore.hashOfBuilder = await fs.readFile(path.join(__dirname, '../../../builderHashFile'), 'utf8');
      this.currentStore.startBuildTime = new Date().getTime();
      await pMap(
         this.config.modules,
         async(moduleInfo) => {
            const currentModuleCachePath = path.join(this.config.cachePath, 'modules-cache', `${moduleInfo.name}.json`);
            this.setDefaultStore(moduleInfo);
            if (patchBuild && await fs.pathExists(currentModuleCachePath) && !moduleInfo.rebuild) {
               this.currentStore.inputPaths[moduleInfo.path] = this.lastStore.inputPaths[moduleInfo.path];
            }
         }
      );
   }

   save() {
      return this.currentStore.save(this.config.cachePath, this.config.logFolder);
   }

   /**
    * Проверяет есть ли несовместимые изменения в проекте, из-за которых нужно очистить кеш.
    * @returns {Promise<boolean>}
    */
   async cacheHasIncompatibleChanges() {
      const finishText = 'Кеш и результат предыдущей сборки будут удалены, если существуют.';
      if (this.previousRunFailed) {
         logger.info(`В директории кэша с предыдущей сборки остался файл builder.lockfile. ${finishText}`);
         return true;
      }
      if (this.lastStore.hashOfBuilder === 'unknown') {
         logger.info(`Не удалось обнаружить валидный кеш от предыдущей сборки. ${finishText}`);
         return true;
      }
      if (this.lastStore.runningParameters.criticalErrors) {
         logger.info(`Предыдущий билд завершился с критическими ошибками. ${finishText}`);
         return true;
      }
      const lastRunningParameters = { ...this.lastStore.runningParameters };
      const currentRunningParameters = { ...this.currentStore.runningParameters };
      const lastModulesList = lastRunningParameters.modules.map(currentModule => currentModule.name);
      const currentModulesList = currentRunningParameters.modules.map(currentModule => currentModule.name);
      try {
         assert.deepStrictEqual(lastModulesList, currentModulesList);
      } catch (error) {
         logger.info(`Параметры запуска builder'а поменялись. Изменился список модулей на сборку ${finishText}`);
         return true;
      }

      // check hash of builder code for changes. If changed, rebuild the whole project.
      const isNewBuilder = this.lastStore.hashOfBuilder !== this.currentStore.hashOfBuilder;
      if (isNewBuilder) {
         logger.info(`Hash of builder isn't corresponding to saved in cache. ${finishText}`);
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

      /**
       * for patch and branch tests skip deep checker.
       * In patch build some modules have extra flags for rebuild
       * In branch tests build some modules have another paths(specified to branch name)
       *
        */
      const skipDeepConfigCheck = this.config.modulesForPatch.length > 0 || this.config.branchTests;
      if (skipDeepConfigCheck) {
         return false;
      }

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

      return false;
   }

   /**
    * Чистит кеш, если инкрементальная сборка невозможна.
    */
   async clearCacheIfNeeded() {
      const removePromises = [];
      if (await this.cacheHasIncompatibleChanges()) {
         this.lastStore = new StoreInfo();

         /**
          * we can remove all cache content, except meta created before cache checking:
          * 1)builder.lockfile - protection file for single build of current project.
          * 2)temp-modules - directory of all sources modules symlinks of current project
          */
         if (await fs.pathExists(this.config.cachePath)) {
            for (const fileName of await fs.readdir(this.config.cachePath)) {
               if (!(fileName.endsWith('.lockfile') || fileName === 'temp-modules')) {
                  removePromises.push(fs.remove(path.join(this.config.cachePath, fileName)));
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
      logger.info('Запускается очистка кэша');
      await Promise.all(removePromises);
      logger.info('Очистка кэша завершена');
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
         const lastModuleCache = moduleInfo.cache.lastStore;
         const currentModuleCache = moduleInfo.cache.currentStore;
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

      if (this.dropCacheForMarkup && (prettyPath.endsWith('.xhtml') || prettyPath.endsWith('.tmpl') || prettyPath.endsWith('.wml'))) {
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
         /**
          * if View/Builder components were changed, we need to rebuild all templates in project
          * with current templates processor changes. Also check UI components for changing between
          * 2 builds, it's using by static VDOM pages compiler.
          */
         if (prettyPath.includes('temp-modules/View/Builder/') || prettyPath.includes('temp-modules/UI/')) {
            logger.info(`Templates compiling components was changed. All templates will be rebuilt for current project. Changed component: ${prettyPath}`);
            this.dropCacheForMarkup = true;
         }
         if (prettyPath.endsWith('.less') || prettyPath.endsWith('.js') || prettyPath.endsWith('.es') || prettyPath.endsWith('.ts') || prettyPath.endsWith('.ts')) {
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
      /**
       * Current interface module name may be a part of another interface module.
       * Make sure we get paths only for current interface module.
       */
      const prettyModulePath = helpers.prettifyPath(`${modulePath}/`);
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
      if (!this.currentStore.dependencies.hasOwnProperty(prettyPath)) {
         this.currentStore.dependencies[prettyPath] = [];
      }

      // add new imports into less dependencies
      imports.forEach((currentImport) => {
         const prettyImport = helpers.unixifyPath(currentImport);
         if (!this.currentStore.dependencies[prettyPath].includes(prettyImport)) {
            this.currentStore.dependencies[prettyPath].push(prettyImport);
         }
      });
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

   deleteFailedFromCacheInputs(filePath) {
      const prettyPath = helpers.prettifyPath(filePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyPath)) {
         delete this.currentStore.inputPaths[prettyPath];
      }
   }

   /**
    * Сохранить в кэше конфигурацию сборки less для данного Интерфейсного
    * модуля
    * @param{String} moduleName - название Интерфейсного модуля
    * @param config
    */
   async addModuleLessConfiguration(moduleName, config, cacheDirectory) {
      const lastModuleLessConfig = this.lastStore.lessConfig[moduleName];

      /**
       * if themes config was changed since the last build,
       * rebuild all less in current project to get actual themed css content
       */
      try {
         assert.deepStrictEqual(config, lastModuleLessConfig);
      } catch (error) {
         this.dropCacheForLess = true;
      }
      this.currentStore.lessConfig[moduleName] = config;
      if (!await fs.pathExists(path.join(cacheDirectory, 'save-cache-for-less.json')) && !this.dropCacheForLess) {
         this.dropCacheForLess = true;
      }
   }

   /**
    * Получить из кэша конфигурацию сборки less для данного Интерфейсного
    * модуля
    * @returns {*}
    */
   getModuleLessConfiguration(moduleName) {
      return this.currentStore.lessConfig[moduleName];
   }

   /**
    * adds new theme into style themes cache
    * @param{String} folderName - Interface module name
    * @param{Object} config - base info about current theme
    */
   addNewStyleTheme(themeModule, modifier, config) {
      const { moduleName, themeName } = config;
      const { styleThemes } = this.currentStore;
      if (!styleThemes.hasOwnProperty(themeModule)) {
         styleThemes[themeModule] = {
            type: 'new',
            moduleName,
            themeName,
            modifiers: [modifier]
         };
      } else {
         styleThemes[themeModule].modifiers.push(modifier);
      }
   }

   getNewStyleTheme(themeModule) {
      const { styleThemes } = this.currentStore;
      return styleThemes[themeModule];
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
    * Stores themed modules meta into current interface module cache.
    * Example: for theme Interface module "Controls-showcase-theme",
    * for themed less component "decorator" would be stored next information:
    * Controls/decorator: ["showcase"]
    * @param{String} moduleName - current interface module name
    * @param{String} lessName - current less file name
    * @param{String} themeModifier - current theme name
    * @param{String} themeName - current theme name
    */
   storeNewThemesModules(moduleName, lessName, themeModifier, themeName) {
      const currentLessControl = helpers.unixifyPath(`${moduleName}/${lessName}`);
      if (!this.currentStore.newThemesModules.hasOwnProperty(moduleName)) {
         this.currentStore.newThemesModules[moduleName] = {};
      }
      const currentNewThemesMeta = this.currentStore.newThemesModules[moduleName];
      if (!currentNewThemesMeta.hasOwnProperty(currentLessControl)) {
         currentNewThemesMeta[currentLessControl] = [];
      }
      const themeNameWithModifier = themeModifier ? `${themeName}:${themeModifier.replace(/\//g, ':')}` : themeName;
      if (!currentNewThemesMeta[currentLessControl].includes(themeNameWithModifier)) {
         currentNewThemesMeta[currentLessControl].push(themeNameWithModifier);
      }
   }

   /**
    * Gets new themes meta info for current Interface module
    * @returns {newThemesModules|{}}
    */
   getNewThemesModulesCache(moduleName) {
      return this.currentStore.newThemesModules[moduleName] || {};
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

   /**
    * Получить список файлов, которые нужно удалить из целевой директории после инкрементальной сборки
    * @returns {Promise<string[]>}
    */
   async getListForRemoveFromOutputDir(outputPath, modulesForPatch) {
      const currentOutputSet = this.currentStore.getOutputFilesSet();

      /**
       * In patch build we must get paths only for modules are
       * participated in current patch build. Otherwise we can
       * remove files for non-participating interface modules from
       * builder cache and get artifacts in next patch builds.
       * @type {Set<string>}
       */
      const lastOutputSet = this.lastStore.getOutputFilesSet(outputPath, modulesForPatch.map(
         currentModule => path.basename(currentModule.output)
      ));
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
}

module.exports = Cache;
