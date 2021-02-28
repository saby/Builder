/**
 * @author Kolbeshin F.A.
 */
'use strict';

const fs = require('fs-extra'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   { defaultCssVariablesOptions } = require('../../../lib/builder-constants');

/**
 * Class with current build data. For incremental build processing.
 */
class StoreInfo {
   constructor() {
      // в случае изменений параметров запуска проще кеш сбросить,
      // чем потом ошибки на стенде ловить. не сбрасываем только кеш json
      this.runningParameters = {};

      // If hash sum of builder source code was changed we can't use previous builder cache as valid.
      // unknown has further using
      this.hashOfBuilder = 'unknown';

      // время начала предыдущей сборки. нам не нужно хранить дату изменения каждого файла
      // для сравнения с mtime у файлов
      this.startBuildTime = 0;

      // запоминаем что было на входе и что породило на выход, чтобы потом можно было
      // 1. отследить восстановленный из корзины файл
      // 2. удалить лишние файлы
      this.inputPaths = {};

      // information about all minified files that haven't changed since last build.
      this.cachedMinified = {};

      // для инкрементальной сборки нужно знать зависимости файлов:
      // - imports из less файлов
      // - зависимости js на файлы вёрстки для паковки собственных зависмостей
      this.dependencies = {};

      // Чтобы ошибки не терялись при инкрементальной сборке, нужно запоминать файлы с ошибками
      // и подавать их при повторном запуске как изменённые
      this.filesWithErrors = new Set();

      this.themesMeta = {
         cssVariablesOptions: {
            ...defaultCssVariablesOptions,
            variables: {}
         },

         /**
          * Object with all meta info about themes:
          * 1) output theme name(e.g. default, default__cola, default__pink, etc.)
          * 2) list of parts of the theme with theirs relatives paths
          * 3) parameter value whether it should be rebuilt
          */
         themes: {},

         // all essential info about fallback.json meta
         // 1) variables map(from which fallback.json it was taken)
         // 2) overall hash sum(it's required to make
         // a decision whether drop cache for all built less files)
         fallbackList: {
            variablesMap: {},
            OVERALL_HASH: ''
         }
      };
   }

   static getLastRunningParametersPath(cacheDirectory, isPatchBuild) {
      return path.join(cacheDirectory, `last_build_gulp_config${isPatchBuild ? '_for_patch' : ''}.json`);
   }

   async load(cacheDirectory) {
      if (await fs.pathExists(path.join(cacheDirectory, 'builder-info.json'))) {
         logger.debug(`Reading builder cache from directory "${cacheDirectory}"`);
         const commonStoredConfigPath = StoreInfo.getLastRunningParametersPath(cacheDirectory);
         if (await fs.pathExists(commonStoredConfigPath)) {
            this.runningParameters = await fs.readJSON(commonStoredConfigPath);
         } else {
            // if there is no stored common gulp_config, first build was a patch. It happens,
            // when builder cache was removed, also it's a common situation for builder unit tests
            this.runningParameters = await fs.readJSON(StoreInfo.getLastRunningParametersPath(cacheDirectory, true));
         }


         try {
            const builderInfo = await fs.readJson(path.join(cacheDirectory, 'builder-info.json'));
            this.hashOfBuilder = builderInfo.hashOfBuilder;
            logger.debug(`"hashOfBuilder" in builder cache: ${this.hashOfBuilder}`);
            this.startBuildTime = builderInfo.startBuildTime;
            logger.debug(`"startBuildTime" in builder cache: ${this.startBuildTime}`);
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'builder-info.json')}" failed to be read`,
               error
            });
         }
         try {
            this.inputPaths = await fs.readJson(path.join(cacheDirectory, 'input-paths.json'));
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'input-paths.json')}" failed to be read`,
               error
            });
         }
         try {
            this.cachedMinified = await fs.readJson(path.join(cacheDirectory, 'cached-minified.json'));
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'cached-minified.json')}" failed to be read`,
               error
            });
         }
         try {
            this.dependencies = await fs.readJson(path.join(cacheDirectory, 'dependencies.json'));
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'dependencies.json')}" failed to be read`,
               error
            });
         }
         try {
            const filesWithErrors = await fs.readJson(path.join(cacheDirectory, 'files-with-errors.json'));
            this.filesWithErrors = new Set(filesWithErrors);
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'files-with-errors.json')}" failed to be read`,
               error
            });
         }

         try {
            this.themesMeta = await fs.readJson(path.join(cacheDirectory, 'themesMeta.json'));
         } catch (error) {
            logger.info({
               message: `Cache file "${path.join(cacheDirectory, 'themesMeta.json')}" failed to be read`,
               error
            });
         }
      }
   }

   async save(cacheDirectory, logFolder, isPatchBuild) {
      await fs.outputJson(
         path.join(cacheDirectory, 'builder-info.json'),
         {
            hashOfBuilder: this.hashOfBuilder,
            startBuildTime: this.startBuildTime
         },
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'input-paths.json'),
         this.inputPaths,
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'themesMeta.json'),
         this.themesMeta,
         {
            spaces: 1
         }
      );
      await fs.outputJson(
         path.join(cacheDirectory, 'dependencies.json'),
         this.dependencies,
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'files-with-errors.json'),
         [...this.filesWithErrors],
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         StoreInfo.getLastRunningParametersPath(cacheDirectory, isPatchBuild),
         this.runningParameters,
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'cache-path.json'),
         {
            lastCacheDirectory: cacheDirectory,
            lastLogFolder: logFolder
         },
         {
            spaces: 1
         }
      );

      await fs.outputJson(
         path.join(cacheDirectory, 'save-cache-for-less.json'),
         {}
      );

      // save a sign that cache was saved successfully. Needs by builder
      // to make a correct decision whether cache should be removed
      await fs.outputFile(path.join(cacheDirectory, 'cache.lockfile'), '');
   }

   /**
    * Get output files list to get difference between 2 builds and remove trash
    * @param{String} cachePath - physical path to builder cache
    * @param{Array} modulesForPatch - interface modules to be patched
    * @returns {Set<any>}
    */
   getOutputFilesSet(modulesForPatch) {
      const resultSet = new Set();
      for (const filePath in this.inputPaths) {
         if (!this.inputPaths.hasOwnProperty(filePath)) {
            continue;
         }
         for (const relativeFilePath of this.inputPaths[filePath].output) {
            // get only paths for patching modules in patch build
            if (modulesForPatch && modulesForPatch.length > 0) {
               const currentModuleName = relativeFilePath.split('/').shift();
               if (modulesForPatch.includes(currentModuleName)) {
                  resultSet.add(relativeFilePath);
               }
            } else {
               resultSet.add(relativeFilePath);
            }
         }
      }
      return resultSet;
   }
}

module.exports = StoreInfo;
