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
 * Regex that checks if a file depends on a markup generator changes
 * @type {RegExp}
 */
const MARKUP_DEPEND_FILES_REGEX = /(\.xhtml)|(\.wml)|(\.tmpl)|(\.ts)|(\.js)$/;

/**
 * Regex that checks if a file saves into builder's cache
 * @type {RegExp}
 */
const CACHED_FILES_EXTENSIONS = /(\.less)|(\.js)|(\.es)|(\.ts)$/;

/**
 * Creates a hash by content for current file
 * @param fileContents
 * @returns {string}
 */
function generateHash(fileContents) {
   return crypto
      .createHash('sha1')
      .update(fileContents)
      .digest('base64');
}

/**
 * Gets file hash
 * @param fileContent
 * @param hashByContent
 * @param fileStamp
 */
function getFileHash(fileContents, hashByContent, fileStamp) {
   if (!hashByContent) {
      return fileStamp;
   }
   let hash = '';
   if (fileContents) {
      hash = crypto
         .createHash('sha1')
         .update(fileContents)
         .digest('base64');
   }
   return hash;
}

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

      // store of compiled resources. It is the storage to be used
      // if there are compiled sources selected to be used in current
      // build.
      this.compiledStore = {};
   }

   // setting default store values for current interface module
   setDefaultStore(moduleInfo) {
      this.currentStore.inputPaths[moduleInfo.name] = {
         hash: '',
         output: []
      };
   }

   // loads essential cache of compiled sources
   async loadCompiled() {
      const compiledStoreRoot = path.dirname(this.config.compiled);
      this.compiledStore.dependencies = await fs.readJson(path.join(compiledStoreRoot, 'dependencies.json'));
      this.compiledStore.inputPaths = await fs.readJson(path.join(compiledStoreRoot, 'input-paths.json'));
   }

   // checks whether first or not is current build
   isFirstBuild() {
      return this.lastStore.startBuildTime === 0;
   }

   async load(modulesForPatch) {
      const patchBuild = modulesForPatch && modulesForPatch.length > 0;
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

      if (patchBuild && this.lastStore.themesMeta) {
         const lastStoreThemes = this.lastStore.themesMeta.themes;
         const currentStoreThemes = this.currentStore.themesMeta.themes;
         Object.keys(lastStoreThemes).forEach((currentTheme) => {
            lastStoreThemes[currentTheme].forEach((currentThemePart) => {
               const moduleName = currentThemePart.split('/').shift();
               if (!modulesForPatch.includes(moduleName)) {
                  if (!currentStoreThemes.hasOwnProperty(currentTheme)) {
                     currentStoreThemes[currentTheme] = [];
                  }
                  currentStoreThemes[currentTheme].push(currentThemePart);
               }
            });
         });
      }

      await pMap(
         this.config.modules,
         async(moduleInfo) => {
            const currentModuleCachePath = path.join(this.config.cachePath, 'modules-cache', `${moduleInfo.name}.json`);
            this.setDefaultStore(moduleInfo);
            if (
               patchBuild &&
               await fs.pathExists(currentModuleCachePath) &&
               !moduleInfo.rebuild &&
               this.lastStore.inputPaths[moduleInfo.path]
            ) {
               this.currentStore.inputPaths[moduleInfo.name] = this.lastStore.inputPaths[moduleInfo.name];
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
      // do no check of gulp_config if it's disabled manually
      if (!this.config.checkConfig) {
         return false;
      }
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
      const lastModulesList = lastRunningParameters.modules.map(currentModule => currentModule.name).sort();
      const currentModulesList = currentRunningParameters.modules.map(currentModule => currentModule.name).sort();
      try {
         assert.deepStrictEqual(lastModulesList, currentModulesList);
      } catch (error) {
         logger.info(`Параметры запуска builder'а поменялись. Изменился список модулей на сборку ${finishText}`);
         logger.info(error);
         return true;
      }

      // check hash of builder code for changes. If changed, rebuild the whole project.
      // In new version builder code can be changed too often, ergo causes cache removal in all
      // of branch tests(controls, engine, ui, etc.) that sometimes is needless due to kind of
      // changes in builder and nonetheless causes build time decrease as often as we aren't expected.
      // Thus, for now don't use this feature in branch tests until there is a better solution to choose
      // whether or not builder cache should be removed due to builder code base changes.
      const isNewBuilder = this.lastStore.hashOfBuilder !== this.currentStore.hashOfBuilder;
      if (isNewBuilder && !this.config.branchTests) {
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

      // list of modules shouldn't affect builder cache anyhow. Builder will either build new interface module that
      // wasn't in a project before or delete all information about the one(cache, artifacts of this module in output).
      // That should give us an opportunity to get build faster with incremental build of non-changing modules and new
      // build of new ones.
      delete lastRunningParameters.modules;
      delete currentRunningParameters.modules;
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
      const cacheHasIncompatibleChanges = await this.cacheHasIncompatibleChanges();
      if (cacheHasIncompatibleChanges) {
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
      } else {
         /**
          * Clean all custom pack artifacts of previous build from output directory to always get an actual
          * output directory list content without any outdated files.
          * @type {string}
          */
         const outputFilesListPath = path.join(this.config.cachePath, 'output-files-to-remove.json');
         if (await fs.pathExists(outputFilesListPath)) {
            const filesListToRemove = await fs.readJson(outputFilesListPath);
            const prettyCurrentOutput = helpers.prettifyPath(this.config.rawConfig.output);
            filesListToRemove.forEach((filePath) => {
               // clearance of custompack artifacts is needed if builder results
               // will be written in the same folder as a previous build was.
               if (filePath.startsWith(prettyCurrentOutput)) {
                  removePromises.push(fs.remove(filePath));
               }
            });
         }
      }

      // output directory must be force cleaned if cache is incompatible or it is patch build.
      const needToCleanOutput = cacheHasIncompatibleChanges || this.config.modulesForPatch.length > 0;
      if (
         needToCleanOutput &&
         this.config.outputPath !== this.config.rawConfig.output &&
         !this.config.isSourcesOutput &&
         this.config.clearOutput
      ) {
         if (await fs.pathExists(this.config.rawConfig.output)) {
            removePromises.push(fs.remove(this.config.rawConfig.output));
         }
      }

      if (removePromises.length === 0) {
         return;
      }
      logger.info('Running cache clean');
      await Promise.all(removePromises);
      logger.info('Cache clean was completed successfully!');
   }

   /**
    * Проверяет нужно ли заново обрабатывать файл или можно ничего не делать.
    * @param {string} filePath путь до файла
    * @param {Buffer} fileContents содержимое файла
    * @param {ModuleInfo} moduleInfo информация о модуле.
    * @returns {Promise<boolean>}
    */
   async isFileChanged(filePath, fileContents, hashByContent, fileTimeStamp, moduleInfo) {
      const prettyPath = helpers.unixifyPath(filePath);
      const prettyRelativePath = helpers.getRelativePath(moduleInfo.appRoot, prettyPath);

      const hash = getFileHash(fileContents, hashByContent, fileTimeStamp);
      const isChanged = await this._isFileChanged(
         hashByContent,
         moduleInfo.appRoot,
         prettyRelativePath,
         prettyPath,
         hash
      );

      const relativePath = path.relative(moduleInfo.path, filePath);
      const outputRelativePath = path.join(path.basename(moduleInfo.output), transliterate(relativePath));
      this.currentStore.inputPaths[prettyRelativePath] = {
         hash,
         output: [helpers.unixifyPath(outputRelativePath)]
      };

      if (!isChanged) {
         // вытащим данные из старого кеша в новый кеш
         const lastModuleCache = moduleInfo.cache.lastStore;
         const currentModuleCache = moduleInfo.cache.currentStore;
         if (lastModuleCache.componentsInfo.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.componentsInfo[prettyRelativePath] = lastModuleCache.componentsInfo[prettyRelativePath];
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

         if (lastModuleCache.cdnModules.hasOwnProperty(prettyPath)) {
            currentModuleCache.cdnModules[prettyPath] = lastModuleCache.cdnModules[prettyPath];
         }
         if (this.lastStore.dependencies.hasOwnProperty(prettyRelativePath)) {
            this.currentStore.dependencies[prettyRelativePath] = this.lastStore.dependencies[prettyRelativePath];
         }
      }

      return isChanged;
   }

   async _isFileChanged(hashByContent, root, prettyRelativePath, prettyPath, hash) {
      // кеша не было, значит все файлы новые
      if (!this.lastStore.startBuildTime) {
         return true;
      }

      /**
       * if templates cache was dropped off, we need also to rebuild ts files because of pack own dependencies task
       * needs a compiled js file(from ts source) to pack actual compiled template into it. That behaviour could be
       * established only with force cache reset for ts files. For js files cache checker will detect a change of
       * dependent wml files, so there is no need of force reset of cache for those.
       */
      if (this.dropCacheForMarkup && MARKUP_DEPEND_FILES_REGEX.test(prettyPath)) {
         return true;
      }

      // если список тем поменялся, то нужно все less пересобрать
      if (this.dropCacheForLess && (prettyPath.endsWith('.less'))) {
         return true;
      }

      // новый файл
      if (!this.lastStore.inputPaths.hasOwnProperty(prettyRelativePath)) {
         return true;
      }

      // файл с ошибкой
      if (this.lastStore.filesWithErrors.has(prettyPath)) {
         return true;
      }

      if (this.lastStore.inputPaths[prettyRelativePath].hash !== hash) {
         /**
          * if View/Builder components were changed, we need to rebuild all templates in project
          * with current templates processor changes. Also check UI components for changing between
          * 2 builds, it's using by static VDOM pages compiler.
          */
         if (prettyPath.includes('temp-modules/UI/')) {
            logger.info(`Templates compiling components was changed. All templates will be rebuilt for current project. Changed component: ${prettyPath}`);
            this.dropCacheForMarkup = true;
         }
         if (CACHED_FILES_EXTENSIONS.test(prettyPath)) {
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

      if (CACHED_FILES_EXTENSIONS.test(prettyRelativePath)) {
         const isChanged = await this._isDependenciesChanged(hashByContent, prettyRelativePath, root);
         this.cacheChanges[prettyRelativePath] = isChanged;
         return isChanged;
      }

      return false;
   }

   setBaseThemeInfo(resultThemeName) {
      const { themes } = this.currentStore.themesMeta;
      if (!themes.hasOwnProperty(resultThemeName)) {
         themes[resultThemeName] = [];
      }
   }

   /**
    * adds meta info about current theme part into common cache
    * @param{String} resultThemeName - normalized theme name
    * (with modifier if exists, e.g. default__dark)
    * @param{String} relativePath - relative path of theme part
    * @param{boolean} newFile - whether this theme part is new
    */
   addThemePartIntoMeta(resultThemeName, relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      const { themes } = this.currentStore.themesMeta;
      if (!themes[resultThemeName].includes(prettyRelativePath)) {
         themes[resultThemeName].push(prettyRelativePath);
      }
   }

   getThemesMeta() {
      return this.currentStore.themesMeta;
   }

   addCssVariables(moduleVariables) {
      const { variables } = this.currentStore.themesMeta.cssVariablesOptions;
      Object.keys(moduleVariables).forEach((currentVariable) => {
         variables[currentVariable] = moduleVariables[currentVariable];
      });
   }

   getCssVariablesoptions() {
      return this.currentStore.themesMeta.cssVariablesOptions;
   }

   /**
    * Добавляет в кеш информацию о дополнительных генерируемых файлах.
    * Это нужно, чтобы в финале инкрементальной сборки удалить только не актуальные файлы.
    * @param {string} filePath путь до файла
    * @param {string} outputFilePath путь до генерируемого файла.
    * @param {ModuleInfo} moduleInfo информация о модуле.
    */
   addOutputFile(filePath, outputFilePath, moduleInfo) {
      const prettyRoot = helpers.unixifyPath(moduleInfo.appRoot);
      const prettyOutput = helpers.unixifyPath(path.dirname(moduleInfo.output));
      const prettyRelativePath = helpers.getRelativePath(prettyRoot, filePath);
      const outputPrettyRelativePath = helpers.getRelativePath(prettyOutput, outputFilePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyRelativePath)) {
         this.currentStore.inputPaths[prettyRelativePath].output.push(outputPrettyRelativePath);
      } else {
         // некоторые файлы являются производными от всего модуля. например en-US.js, en-US.css
         this.currentStore.inputPaths[moduleInfo.name].output.push(outputPrettyRelativePath);
      }
   }

   /**
    * Creates a hash by content for current file
    * @param filePath
    * @param fileContents
    */
   createContentHash(filePath, fileContents) {
      this.currentStore.cachedMinified[filePath] = generateHash(fileContents);
   }

   /**
    * Returns a hash by content for a given relative file path
    * @param relativePath
    * @returns {*}
    */
   getHash(relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      const currentFileCache = this.currentStore.inputPaths[prettyRelativePath];

      /**
       * if there is no saved cache for current file
       * it could mean that this file was generated in some
       * builder plugin without origin source(f.e. joined css
       * localization, created by plugin with using of current
       * interface module localization styles)
       */
      if (!currentFileCache) {
         return '';
      }
      return currentFileCache.hash;
   }

   /**
    * checks file hash to be equal as previously generated in cache
    * Needed for incremental build.
    * @param{String} filePath - full path of current file
    * @returns {boolean}
    */
   minifiedIsCached(filePath) {
      return this.currentStore.cachedMinified[filePath] === this.lastStore.cachedMinified[filePath];
   }

   getCachedMinified() {
      return this.currentStore.cachedMinified;
   }

   getOutputForFile(filePath, moduleInfo) {
      const prettyRoot = helpers.unixifyPath(moduleInfo.appRoot);
      const prettyRelativeFilePath = helpers.getRelativePath(prettyRoot, filePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyRelativeFilePath)) {
         return this.currentStore.inputPaths[prettyRelativeFilePath].output;
      }
      return [];
   }

   /**
    * Получить список файлов из исходников, которые относятся к конкретному модулю
    * @param {string} modulePath путь до модуля
    * @returns {string[]}
    */
   getInputPathsByFolder(moduleName) {
      return Object.keys(this.currentStore.inputPaths).filter(filePath => filePath.startsWith(`${moduleName}/`));
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
   addDependencies(root, filePath, imports) {
      const prettyRoot = helpers.unixifyPath(root);
      const prettyRelativePath = helpers.removeLeadingSlashes(
         helpers.unixifyPath(filePath).replace(prettyRoot, '')
      );
      if (!this.currentStore.dependencies.hasOwnProperty(prettyRelativePath)) {
         this.currentStore.dependencies[prettyRelativePath] = [];
      }

      // add new imports into less dependencies
      imports.forEach((currentImport) => {
         const prettyRelativeImport = helpers.removeLeadingSlashes(
            helpers.unixifyPath(currentImport).replace(prettyRoot, '')
         );
         if (!this.currentStore.dependencies[prettyRelativePath].includes(prettyRelativeImport)) {
            this.currentStore.dependencies[prettyRelativePath].push(prettyRelativeImport);
         }
      });
   }

   getDependencies(relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      return this.currentStore.dependencies[prettyRelativePath] || [];
   }

   getCompiledDependencies(relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      return this.compiledStore.dependencies[prettyRelativePath];
   }

   getCompiledHash(relativePath) {
      const prettyRelativePath = helpers.unixifyPath(relativePath);
      if (this.compiledStore.inputPaths[prettyRelativePath]) {
         return this.compiledStore.inputPaths[prettyRelativePath].hash;
      }
      return '';
   }

   compareWithCompiled(relativePath) {
      const compiledHash = this.getCompiledHash(relativePath);
      if (compiledHash && this.getHash(relativePath) === compiledHash) {
         return true;
      }
      return false;
   }

   getLastStoreDependencies() {
      return this.lastStore.dependencies;
   }

   /**
    * Проверить изменились ли зависимости текущего файла
    * @param {string} filePath путь до файла
    * @returns {Promise<boolean>}
    */
   async _isDependenciesChanged(hashByContent, relativePath, root) {
      const dependencies = this.getAllDependencies(relativePath);
      if (dependencies.length === 0) {
         return false;
      }
      const listChangedDeps = await pMap(
         dependencies,
         async(currentRelativePath) => {
            if (this.cacheChanges.hasOwnProperty(currentRelativePath)) {
               return this.cacheChanges[currentRelativePath];
            }
            if (
               !this.lastStore.inputPaths.hasOwnProperty(currentRelativePath) ||
               !this.lastStore.inputPaths[currentRelativePath].hash
            ) {
               return true;
            }
            let isChanged = false;
            const currentPath = path.join(root, currentRelativePath);
            if (await fs.pathExists(currentPath)) {
               if (hashByContent) {
                  const fileContents = await fs.readFile(currentPath);
                  const hash = crypto
                     .createHash('sha1')
                     .update(fileContents)
                     .digest('base64');
                  isChanged = this.lastStore.inputPaths[currentRelativePath].hash !== hash;
               } else {
                  const fileStats = await fs.stat(currentRelativePath);
                  isChanged = this.lastStore.inputPaths[currentRelativePath].hash !== fileStats.mtime.toString();
               }
            } else {
               isChanged = true;
            }
            this.cacheChanges[currentRelativePath] = isChanged;
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

   deleteFailedFromCacheInputs(filePath, moduleInfo) {
      const prettyRoot = helpers.unixifyPath(moduleInfo.appRoot);
      const prettyRelativePath = helpers.getRelativePath(prettyRoot, filePath);
      if (this.currentStore.inputPaths.hasOwnProperty(prettyRelativePath)) {
         delete this.currentStore.inputPaths[prettyRelativePath];
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

   /**
    * Получить список файлов, которые нужно удалить из целевой директории после инкрементальной сборки
    * @returns {Promise<string[]>}
    */
   async getListForRemoveFromOutputDir(cachePath, outputPath, modulesForPatch) {
      const currentOutputSet = this.currentStore.getOutputFilesSet();

      /**
       * In patch build we must get paths only for modules are
       * participated in current patch build. Otherwise we can
       * remove files for non-participating interface modules from
       * builder cache and get artifacts in next patch builds.
       * @type {Set<string>}
       */
      const lastOutputSet = this.lastStore.getOutputFilesSet(
         modulesForPatch.map(currentModule => path.basename(currentModule.output))
      );
      let removeFiles = Array.from(lastOutputSet)
         .filter(relativeFilePath => !currentOutputSet.has(relativeFilePath))
         .map(relativeFilePath => helpers.unixifyPath(path.join(cachePath, relativeFilePath)));

      /**
       * in case of release mode there are 2 folder to remove outdated files therefrom:
       * 1) cache directory
       * 2) output directory
       * We need to remove it from these directories
       */
      if (outputPath !== cachePath) {
         removeFiles = [...removeFiles, ...removeFiles.map(currentFile => currentFile.replace(cachePath, outputPath))];
      }
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
