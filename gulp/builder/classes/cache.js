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
 * Extensions for files that are to be compressed
 * @type {Set<string>}
 */
const COMPRESSED_EXTENSIONS = new Set([
   '.js',
   '.json',
   '.css',
   '.tmpl',
   '.wml'
]);

// important flags for builder cache
const CACHE_INDEPENDENT_FLAGS = new Set([

   // list of modules shouldn't affect cache invalidation, removed module will be removed from cache
   // new module will be compiled and added to cache
   'modules',

   // changed logs folder can't be a sane reason for a cache removal
   'logs',

   // tsc uses its own cache for incremental build
   'tsc',
   'tsconfig',

   // all non-incremental tasks are independent of data from builder cache
   'joinedMeta',
   'customPack',
   'checkModuleDependencies',
   'deprecatedStaticHtml',
   'inlineScripts',
   'compress',
   'staticServer'
]);

// non-important flags for builder cache. e.g. path can be changed
// and if file hash by content was changed, it'll be rebuilt, then.
const MODULE_CACHE_INDEPENDENT_FLAGS = new Set(['path', 'rebuild', 'depends']);

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

// filter object by current filter function
function filterObject(object, filter) {
   const result = {};
   Object.keys(object).forEach((currentKey) => {
      if (filter(currentKey)) {
         result[currentKey] = object[currentKey];
      }
   });
   return result;
}

/**
 * check common list of flags that affects builder cache generating
 * @param lastRunningParameters - previous build running parameters
 * @param currentRunningParameters - current build running parameters
 * @returns {boolean} true if flags were changed between 2 builds
 */
function checkCommonFlags(lastRunningParameters, currentRunningParameters, finishText) {
   const isFlagDependent = flag => !CACHE_INDEPENDENT_FLAGS.has(flag);
   const currentCacheFlags = filterObject(currentRunningParameters, isFlagDependent);
   const lastCacheFlags = filterObject(lastRunningParameters, isFlagDependent);

   try {
      assert.deepStrictEqual(currentCacheFlags, lastCacheFlags);
   } catch (error) {
      logger.info(`Common list of flags was changed. ${finishText}`);
      logger.info(error);
      return true;
   }
   return false;
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
      this.dropCacheForStaticMarkup = false;
      this.dropCacheForLess = false;
      this.dropCacheForTsc = false;
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

   // moves old cache if it's interface module isn't participating in
   // current patch build
   migrateCacheForPatch(modulesForPatch, cacheName) {
      if (this.lastStore[cacheName]) {
         const lastStoreCacheForCurrentName = this.lastStore[cacheName];
         const currentStoreCacheForCurrentName = this.currentStore[cacheName];
         Object.keys(lastStoreCacheForCurrentName).forEach((currentPath) => {
            const moduleName = currentPath.split('/').shift();
            if (!modulesForPatch.includes(moduleName)) {
               currentStoreCacheForCurrentName[currentPath] = lastStoreCacheForCurrentName[currentPath];
            }
         });
      }
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

      if (patchBuild) {
         if (this.lastStore.themesMeta) {
            const lastStoreThemes = this.lastStore.themesMeta.themes;
            const currentStoreThemes = this.currentStore.themesMeta.themes;
            Object.keys(lastStoreThemes)
               .forEach((currentTheme) => {
                  lastStoreThemes[currentTheme].forEach((currentThemePart) => {
                     const moduleName = currentThemePart.split('/')
                        .shift();
                     if (!modulesForPatch.includes(moduleName)) {
                        if (!currentStoreThemes.hasOwnProperty(currentTheme)) {
                           currentStoreThemes[currentTheme] = [];
                        }
                        currentStoreThemes[currentTheme].push(currentThemePart);
                     }
                  });
               });
         }
         const modulesForPatchNames = modulesForPatch.map(moduleInfo => moduleInfo.name);

         this.migrateCacheForPatch(modulesForPatchNames, 'inputPaths');
         this.migrateCacheForPatch(modulesForPatchNames, 'dependencies');
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
      return this.currentStore.save(
         this.config.cachePath,
         this.config.logFolder,
         this.config.modulesForPatch.length > 0
      );
   }

   /**
    * checks difference between modules lists of previous and current builds.
    * if there any changes, typescript cache should be removed, because otherwise
    * tsc command needs enormously bigger amount of time than it should with it's cache
    */
   checkModulesLists(lastRunningParameters, currentRunningParameters) {
      const lastModulesList = lastRunningParameters.modules.map(currentModule => currentModule.name).sort();
      const currentModulesList = currentRunningParameters.modules.map(currentModule => currentModule.name).sort();
      try {
         assert.deepStrictEqual(lastModulesList, currentModulesList);
      } catch (error) {
         logger.info('List of modules has been changed. tsc cache will be removed');
         logger.info(error);
         this.dropCacheForTsc = true;
      }
   }

   // checks if there is any output directory for stayed module(exists
   // in both previous and current builds) that was somehow removed.
   async checkOutputModulesDirectories(lastModulesList, finishText) {
      const stayedModules = {};
      this.config.modules.filter(
         currentModule => lastModulesList.has(currentModule.name)
      ).forEach((currentModule) => {
         stayedModules[currentModule.name] = currentModule;
      });

      // check output existing only for modules that weren't removed
      // since the last build
      let outputCheckResult = false;
      await pMap(
         Object.values(stayedModules),
         async(moduleInfo) => {
            const isOutputExists = await fs.pathExists(moduleInfo.output);
            if (!isOutputExists) {
               logger.info(`Output ${moduleInfo.output} for module ${moduleInfo.name} was somehow removed. ${finishText}`);
               outputCheckResult = true;
            }
         }
      );
      return outputCheckResult;
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
      const finishText = 'Cache and a result from a previous build will be removed.';
      if (this.previousRunFailed) {
         logger.info(`There is a "builder.lockfile" in builder cache. ${finishText}`);
         return true;
      }
      if (this.lastStore.hashOfBuilder === 'unknown') {
         logger.info(`Cache isn't existing. ${finishText}`);
         return true;
      }

      if (!this.lastStore.versionedMetaRelativeForDesktop) {
         logger.info(`Cache for versioned meta isn't relative. ${finishText}`);
         return true;
      }

      if (this.lastStore.runningParameters.criticalErrors) {
         logger.info(`Previous build was completed with critical errors. ${finishText}`);
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

      const lastRunningParameters = { ...this.lastStore.runningParameters };
      const currentRunningParameters = { ...this.currentStore.runningParameters };

      // version parameter is always different between 2 builds
      if (lastRunningParameters.version !== '' || currentRunningParameters.version !== '') {
         if (lastRunningParameters.version === '' || currentRunningParameters.version === '') {
            const versionParamStatus = lastRunningParameters.version === '' ? 'enabled' : 'disabled';
            logger.info(`Version parameter has been ${versionParamStatus}. ${finishText}`);
            return true;
         }
         lastRunningParameters.version = '';
         currentRunningParameters.version = '';
      }

      // check whether or not tsc cache should be removed
      this.checkModulesLists(lastRunningParameters, currentRunningParameters);

      // check is there difference between common builder flags that have their influence on a whole project build.
      const isCommonFlagsChanged = checkCommonFlags(lastRunningParameters, currentRunningParameters, finishText);
      if (isCommonFlagsChanged) {
         return true;
      }

      const lastModulesIndexes = {};
      const lastModulesList = new Set(lastRunningParameters.modules.map((currentModule, index) => {
         lastModulesIndexes[currentModule.name] = index;
         return currentModule.name;
      }));

      if (await this.checkOutputModulesDirectories(lastModulesList, finishText)) {
         return true;
      }

      /**
       * for patch and branch tests skip deep modules checker.
       * In patch build some modules have extra flags for rebuild
       */
      const skipDeepConfigCheck = this.config.modulesForPatch.length > 0;
      if (skipDeepConfigCheck) {
         return false;
      }

      // checks each interface module between 2 builds to have equal common flags
      // that have any influence for builder cache
      let modulesDifferenceCheck = false;
      const isDependentModuleFlag = flag => !MODULE_CACHE_INDEPENDENT_FLAGS.has(flag);
      currentRunningParameters.modules.forEach((currentModule) => {
         const lastModule = lastRunningParameters.modules[lastModulesIndexes[currentModule.name]];
         if (lastModule) {
            const lastModuleConfig = filterObject(lastModule, isDependentModuleFlag);
            const currentModuleConfig = filterObject(currentModule, isDependentModuleFlag);
            try {
               assert.deepStrictEqual(lastModuleConfig, currentModuleConfig);
            } catch (error) {
               logger.info(`List of flags for module ${currentModule.name} was changed. ${finishText}`);
               logger.info(error);
               modulesDifferenceCheck = true;
            }
         }
      });

      return modulesDifferenceCheck;
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
      if (this.dropCacheForTsc) {
         const cachePath = path.join(this.config.cachePath, 'typescript-cache');
         removePromises.push(fs.remove(cachePath));
         logger.info(`tsc cache file ${cachePath} was successfully removed`);
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
         if (lastModuleCache.markupCache.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.markupCache[prettyRelativePath] = lastModuleCache.markupCache[prettyRelativePath];
         }
         if (lastModuleCache.esCompileCache.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.esCompileCache[prettyRelativePath] = lastModuleCache.esCompileCache[prettyRelativePath];
         }
         if (lastModuleCache.routesInfo.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.routesInfo[prettyRelativePath] = lastModuleCache.routesInfo[prettyRelativePath];
         }
         if (lastModuleCache.versionedModules.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.versionedModules[
               prettyRelativePath
            ] = lastModuleCache.versionedModules[prettyRelativePath];
         }

         if (lastModuleCache.cdnModules.hasOwnProperty(prettyRelativePath)) {
            currentModuleCache.cdnModules[prettyRelativePath] = lastModuleCache.cdnModules[prettyRelativePath];
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
      if (this.dropCacheForStaticMarkup && prettyPath.endsWith('.html.tmpl')) {
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
            logger.info(`Templates compiling components was changed. All static templates will be rebuilt for current project. Changed component: ${prettyPath}`);
            this.dropCacheForStaticMarkup = true;
         }
         if (prettyPath.includes('temp-modules/Compiler/')) {
            logger.info(`Templates compiling components was changed. All project templates will be rebuilt for current project. Changed component: ${prettyPath}`);
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
      const { themes, themesMap } = this.currentStore.themesMeta;
      if (!themes[resultThemeName].includes(prettyRelativePath)) {
         themes[resultThemeName].push(prettyRelativePath);
      }
      themesMap[prettyRelativePath] = resultThemeName;
   }

   getThemesMeta() {
      return this.currentStore.themesMeta;
   }

   getThemesMetaForWatcher() {
      return this.lastStore.themesMeta;
   }

   addCssVariables(fallbackName, moduleVariables) {
      const variablesList = Object.keys(moduleVariables);

      // if current fallback.json is empty, there is no need in further calculations
      if (variablesList.length === 0) {
         return;
      }

      const { variables } = this.currentStore.themesMeta.cssVariablesOptions;
      const { fallbackList } = this.currentStore.themesMeta;

      variablesList.forEach((currentVariable) => {
         variables[currentVariable] = moduleVariables[currentVariable];
         fallbackList.variablesMap[currentVariable] = fallbackName;
      });
   }

   // checks overall css variables cache. If there are any changes sincle the last build,
   // all less cache will be dropped
   checkCurrentCssVariablesCache(moduleName, currentCssVariables) {
      const { fallbackList } = this.currentStore.themesMeta;

      let LAST_MODULE_HASH;
      if (this.lastStore.themesMeta.hasOwnProperty('fallbackList')) {
         if (this.lastStore.themesMeta.fallbackList.hasOwnProperty('hashes')) {
            LAST_MODULE_HASH = this.lastStore.themesMeta.fallbackList.hashes[moduleName] || '';
         }
      } else {
         LAST_MODULE_HASH = '';
      }
      fallbackList.hashes[moduleName] = generateHash(JSON.stringify(currentCssVariables));
      if (fallbackList.hashes[moduleName] !== LAST_MODULE_HASH) {
         // if overall list of css variables and it's values is changed, drop cache of all
         // less
         logger.info(`Css variables content has been changed for module ${moduleName}, all less files will be rebuilt.`);
         this.dropCacheForLess = true;
      }
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
         const outputExt = path.extname(outputFilePath);

         // add archives into input-paths cache, it could be useful for a garbage collector that removes
         // unneeded artifacts of removed sources.
         if (
            this.config.compress &&
            outputFilePath.endsWith(`.min${outputExt}`) &&
            COMPRESSED_EXTENSIONS.has(outputExt)
         ) {
            this.currentStore.inputPaths[prettyRelativePath].output.push(`${outputPrettyRelativePath}.gz`);
            this.currentStore.inputPaths[prettyRelativePath].output.push(`${outputPrettyRelativePath}.br`);
         }
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
    * stores updated module-dependencies meta.
    * e.g. lazy bundles results have to be stored in builder cache
    * for further debugging if it's necessary
    * @returns {Promise<void>}
    */
   async storeModuleDependencies() {
      await fs.outputJson(path.join(this.config.cachePath, 'module-dependencies.json'), this.moduleDependencies);
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
