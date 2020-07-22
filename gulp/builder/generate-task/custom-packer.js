/**
 * Генерация задачи кастомной паковки.
 * @author Kolbeshin F.A.
 */

'use strict';
const gulp = require('gulp'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   DependencyGraph = require('../../../packer/lib/dependency-graph'),
   collectCustomPacks = require('../plugins/collect-custom-packs'),
   finalizeOptimizeDistrib = require('../plugins/finalize-optimize-distrib'),
   plumber = require('gulp-plumber'),
   {
      saveModuleCustomPackResults,
      saveRootBundlesMeta,
      generateAllCustomPackages,
      collectAllIntersects,
      setSuperBundle
   } = require('../../../lib/pack/custom-packer'),
   pMap = require('p-map'),
   fs = require('fs-extra'),
   transliterate = require('../../../lib/transliterate');

const startTask = require('../../common/start-task-with-timer');

function generateSetSuperBundles(configs, root, modulesForPatch) {
   return function setSuperBundles() {
      return setSuperBundle(configs, root, modulesForPatch);
   };
}

/**
 * Генерация задачи сбора кастомных пакетов
 * @param {TaskParameters} taskParameters набор параметров Gulp - конфигурация, кэш
 * @param {BuildConfiguration} configs набор кастомных пакетов проекта.
 * @param {String} root корень приложения
 * @returns {Undertaker.TaskFunction}
 */
function generateCollectPackagesTasks(configs, taskParameters, root, bundlesList, modulesForPatch) {
   const tasks = taskParameters.config.modules.map((moduleInfo) => {
      // in custom package build interface modules paths are already transliterated
      moduleInfo.depends = moduleInfo.depends.map(currentDep => transliterate(currentDep));
      const input = path.join(moduleInfo.output, '/**/*.package.json');
      return function collectPackageJson() {
         return gulp
            .src(input, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача collectPackageJson завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(collectCustomPacks(moduleInfo, root, configs, bundlesList));
      };
   });
   return gulp.series(
      gulp.parallel(tasks),
      generateSetSuperBundles(configs, root, modulesForPatch)
   );
}

/**
 * Task for bundles list getter
 * @param{Set} bundlesList - full list of bundles
 * @returns {bundlesListGetter}
 */
function generateTaskForBundlesListGetter(bundlesList) {
   return async function bundlesListGetter() {
      const bundlesDirectory = path.join(process.cwd(), 'resources/bundles');
      const filesList = await fs.readdir(bundlesDirectory);
      await pMap(
         filesList,
         async(bundleListName) => {
            const currentPath = path.join(bundlesDirectory, bundleListName);
            try {
               const currentBundles = await fs.readJson(currentPath);
               currentBundles.forEach(currentBundle => bundlesList.add(currentBundle));
            } catch (error) {
               logger.error({
                  message: 'error reading bundles content from builder sources. Check it for syntax errors',
                  filePath: currentPath,
                  error
               });
            }
         },
         {
            concurrency: 20
         }
      );
   };
}

/**
 * Генерация задачи кастомной паковки.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCustomPack(taskParameters) {
   if (!taskParameters.config.customPack || !taskParameters.config.isReleaseMode) {
      return function skipCustomPack(done) {
         done();
      };
   }

   const
      root = taskParameters.config.rawConfig.output,
      depsTree = new DependencyGraph(),
      configs = {
         commonBundles: {},
         superBundles: [],
         extendBundles: taskParameters.config.extendBundles
      },
      results = {
         bundles: {},
         bundlesRoute: {},
         superBundles: {},
         excludedCSS: {},
         extendBundles: {}
      },
      bundlesList = new Set();


   const modulesForPatch = taskParameters.config.modules
      .filter(moduleInfo => moduleInfo.rebuild)
      .map(moduleInfo => path.basename(moduleInfo.output));

   const customPack = startTask('custom pack', taskParameters);
   return gulp.series(
      customPack.start,
      generateDepsGraphTask(depsTree, taskParameters.cache),
      customPack.pluginFinish('custom pack', 'get dependencies graph', customPack.setStartTime),
      generateTaskForBundlesListGetter(bundlesList),
      customPack.pluginFinish('custom pack', 'get bundles approved list', customPack.setStartTime),
      generateCollectPackagesTasks(configs, taskParameters, root, bundlesList, modulesForPatch),
      customPack.pluginFinish('custom pack', 'collect packages configs', customPack.setStartTime),
      generateCustomPackageTask(configs, taskParameters, depsTree, results, root),
      customPack.pluginFinish('custom pack', 'build packages', customPack.setStartTime),
      generateInterceptCollectorTask(taskParameters, root, results),
      customPack.pluginFinish('custom pack', 'collect intercepts', customPack.setStartTime),
      generateSaveResultsTask(taskParameters, results, root, modulesForPatch),
      customPack.pluginFinish('custom pack', 'save results', customPack.setStartTime),
      generateFinalizeOptimizing(taskParameters, root),
      customPack.pluginFinish('custom pack', 'finalize optimizing', customPack.setStartTime)
   );
}

/**
 * мини-таска для пост-обработки конечной директории.
 * Удаляем файлы, которые были необходимы исключительно
 * для паковки, а также все минифицированные AMD-модули
 * и стили, попавшие в публичные(содержатся в оглавлении бандлов)
 * кастомные пакеты.
 * @param taskParameters - набор параметров текущей сборки.
 * @param root
 * @returns {*}
 */
function generateFinalizeOptimizing(taskParameters, root) {
   if (taskParameters.config.sources) {
      return function skipFinalizeOptimizing(done) {
         done();
      };
   }
   taskParameters.filesToRemove = [];
   const tasks = taskParameters.config.modules.map((moduleInfo) => {
      const moduleOutput = path.join(root, transliterate(moduleInfo.name));
      const input = path.join(moduleOutput, '/**/*.*');
      return function finalizeOptimizing() {
         return gulp
            .src(input, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача finalizeOptimizing завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(finalizeOptimizeDistrib(taskParameters));
      };
   });
   return gulp.series(
      gulp.parallel(tasks),
      generateRemoveMinInPackages(taskParameters)
   );
}

async function removeMinInPackages(taskParameters) {
   await pMap(
      taskParameters.filesToRemove,
      async(modulePath) => {
         await fs.remove(modulePath);
      },
      {
         concurrency: 20
      }
   );
}

function generateRemoveMinInPackages(taskParameters) {
   return function removeMinInPackagesTask() {
      return removeMinInPackages(taskParameters);
   };
}

function generateCustomPackageTask(configs, taskParameters, depsTree, results, root) {
   return function custompack() {
      return generateAllCustomPackages(configs, taskParameters, depsTree, results, root);
   };
}


function generateInterceptCollectorTask(taskParameters, root, results) {
   if (taskParameters.config.sources) {
      return function collectIntercepts() {
         return collectAllIntersects(root, results);
      };
   }
   return function skipCollectIntersects(done) {
      done();
   };
}

function generateSaveResultsTask(taskParameters, results, applicationRoot, modulesForPatch) {
   return async function saveCustomPackerResults() {
      if (taskParameters.config.joinedMeta) {
         await saveRootBundlesMeta(taskParameters, applicationRoot, results);
      }
      await saveModuleCustomPackResults(taskParameters, results, applicationRoot, modulesForPatch);

      /**
       * save "module-dependencies" meta for all project into cache. Will be needed
       * in patches to get proper list of modules for custom packing.
       */
      await fs.outputJson(
         path.join(taskParameters.config.cachePath, 'module-dependencies.json'),
         taskParameters.cache.getModuleDependencies()
      );

      await taskParameters.saveRemovalListMeta();
   };
}

function generateDepsGraphTask(depsTree, cache) {
   return function generateDepsGraph(done) {
      const moduleDeps = cache.getModuleDependencies(),
         currentNodes = Object.keys(moduleDeps.nodes),
         currentLinks = Object.keys(moduleDeps.links);

      if (currentLinks.length > 0) {
         currentLinks.forEach((link) => {
            depsTree.setLink(link, moduleDeps.links[link]);
         });
      }
      if (currentNodes.length > 0) {
         currentNodes.forEach((node) => {
            const currentNode = moduleDeps.nodes[node];
            currentNode.path = currentNode.path.replace(/^resources\//, '');
            depsTree.setNode(node, currentNode);
         });
      }
      done();
   };
}

module.exports = generateTaskForCustomPack;
