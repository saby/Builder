/**
 * Генерация задачи кастомной паковки.
 * @author Колбешин Ф.А.
 */

'use strict';
const gulp = require('gulp'),
   path = require('path'),
   generatePackageJson = require('../plugins/custom-packer'),
   logger = require('../../../lib/logger').logger(),
   DependencyGraph = require('../../../packer/lib/dependencyGraph'),
   plumber = require('gulp-plumber'),
   { saveCustomPackResults } = require('../../../lib/pack/custom-packer');

/**
 * Генерация задачи кастомной паковки.
 * @param {ChangesStore} changesStore кеш
 * @param {BuildConfiguration} config конфигурация сборки
 * @returns {Undertaker.TaskFunction|function(done)} В debug режиме вернёт пустышку, чтобы gulp не упал
 */
function generateTaskForCustomPack(changesStore, config) {
   const root = config.rawConfig.output,
      splittedCore = true,
      depsTree = new DependencyGraph(),
      results = {
         bundles: {},
         bundlesRoute: {},
         excludedCSS: {}
      };

   if (!config.isReleaseMode) {
      return function skipCustomPack(done) {
         done();
      };
   }

   const generatePackagesTasks = config.modules.map((moduleInfo) => {
      const moduleOutput = path.join(root, path.basename(moduleInfo.output));
      const input = path.join(moduleOutput, '/**/*.package.json');
      return function custompack() {
         return gulp
            .src(input, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача custompack завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(generatePackageJson(config, depsTree, results, root));
      };
   });

   return gulp.series(
      generateDepsGraphTask(depsTree, changesStore),
      gulp.parallel(generatePackagesTasks),
      generateSaveResultsTask(config, results, root, splittedCore)
   );
}

function generateSaveResultsTask(config, results, applicationRoot, splittedCore) {
   return function saveCustomPackerResults() {
      results.bundlesJson = results.bundles;
      return saveCustomPackResults(results, applicationRoot, splittedCore, true);
   };
}

function generateDepsGraphTask(depsTree, changesStore) {
   return function generateDepsGraph(done) {
      const moduleDeps = changesStore.getModuleDependencies(),
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
