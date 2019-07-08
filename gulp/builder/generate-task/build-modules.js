/**
 * Генерация задачи инкрементальной сборки модулей.
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   gulp = require('gulp'),
   gulpRename = require('gulp-rename'),
   gulpChmod = require('gulp-chmod'),
   plumber = require('gulp-plumber'),
   gulpIf = require('gulp-if');

// наши плагины
const gulpBuildHtmlTmpl = require('../plugins/build-html-tmpl'),
   compileEsAndTs = require('../plugins/compile-es-and-ts'),
   packLibrary = require('../plugins/pack-library'),
   compileJsonToJs = require('../plugins/compile-json-js'),
   compileLess = require('../plugins/compile-less'),
   changedInPlace = require('../../common/plugins/changed-in-place'),
   addComponentInfo = require('../plugins/add-component-info'),
   buildStaticHtml = require('../plugins/build-static-html'),
   createRoutesInfoJson = require('../plugins/create-routes-info-json'),
   createNavigationModulesJson = require('../plugins/create-navigation-modules-json'),
   createVersionedModules = require('../plugins/create-versioned-modules'),
   createCdnModules = require('../plugins/create-cdn-modules'),
   indexDictionary = require('../plugins/index-dictionary'),
   localizeXhtml = require('../plugins/localize-xhtml'),
   buildTmpl = require('../plugins/build-tmpl'),
   createContentsJson = require('../plugins/create-contents-json'),
   createLibrariesJson = require('../plugins/create-libraries-json'),
   createStaticTemplatesJson = require('../plugins/create-static-templates-json'),
   createModuleDependenciesJson = require('../plugins/create-module-dependencies-json'),
   copySources = require('../plugins/copy-sources'),
   filterCached = require('../plugins/filter-cached'),
   filterSources = require('../plugins/filter-sources'),
   buildXhtml = require('../plugins/build-xhtml'),
   minifyCss = require('../plugins/minify-css'),
   minifyJs = require('../plugins/minify-js'),
   minifyOther = require('../plugins/minify-other'),
   packOwnDeps = require('../plugins/pack-own-deps'),
   versionizeToStub = require('../plugins/versionize-to-stub');

const logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate');

const { needSymlink } = require('../../common/helpers');

/**
 * Генерация задачи инкрементальной сборки модулей.
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForBuildModules(taskParameters, modulesForPatch) {
   const tasks = [];
   let countCompletedModules = 0;
   const modulesForBuild = modulesForPatch.length > 0 ? modulesForPatch : taskParameters.config.modules;
   logger.debug(`modules to build count: ${modulesForBuild.length}`);
   const printPercentComplete = function(done) {
      countCompletedModules += 1;
      logger.progress(100 * countCompletedModules / modulesForBuild.length);
      done();
   };

   const modulesMap = new Map();
   for (const moduleInfo of taskParameters.config.modules) {
      modulesMap.set(path.basename(moduleInfo.path), moduleInfo.path);
   }

   for (const moduleInfo of modulesForBuild) {
      tasks.push(
         gulp.series(
            generateTaskForBuildSingleModule(taskParameters, moduleInfo, modulesMap),
            printPercentComplete
         )
      );
   }
   return gulp.parallel(tasks);
}

function generateTaskForBuildSingleModule(taskParameters, moduleInfo, modulesMap) {
   const moduleInput = path.join(moduleInfo.path, '/**/*.*');
   const hasLocalization = taskParameters.config.localizations.length > 0;

   const pathsForImportSet = new Set();
   for (const modulePath of modulesMap.values()) {
      pathsForImportSet.add(path.dirname(modulePath));
   }

   /**
    * Воркер не может принимать мапы в качестве аргумента для функции,
    * только объекты.
    * @type {{}}
    */
   const gulpModulesPaths = {};
   for (const currentModuleName of modulesMap.keys()) {
      gulpModulesPaths[currentModuleName] = modulesMap.get(currentModuleName);
   }
   const gulpModulesInfo = {
      pathsForImport: [...pathsForImportSet],
      gulpModulesPaths
   };

   return function buildModule() {
      return (
         gulp
            .src(moduleInput, { dot: false, nodir: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     taskParameters.cache.markCacheAsFailed();
                     logger.error({
                        message: 'Задача buildModule завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(changedInPlace(taskParameters, moduleInfo))
            .pipe(gulpIf(taskParameters.config.typescript, compileEsAndTs(taskParameters, moduleInfo)))
            .pipe(compileJsonToJs(taskParameters, moduleInfo))
            .pipe(addComponentInfo(taskParameters, moduleInfo))

            // compileLess зависит от addComponentInfo. Нужно для сбора темизируемых less.
            .pipe(
               gulpIf(
                  taskParameters.config.less,
                  compileLess(taskParameters, moduleInfo, gulpModulesInfo)
               )
            )
            .pipe(
               gulpIf(
                  taskParameters.config.htmlWml,
                  gulpBuildHtmlTmpl(taskParameters, moduleInfo)
               )
            )
            .pipe(
               gulpIf(
                  taskParameters.config.deprecatedWebPageTemplates,
                  buildStaticHtml(taskParameters, moduleInfo, modulesMap)
               )
            )

            // versionizeToStub зависит от compileLess, buildStaticHtml и gulpBuildHtmlTmpl
            .pipe(gulpIf(!!taskParameters.config.version, versionizeToStub(taskParameters, moduleInfo)))
            .pipe(gulpIf(hasLocalization, indexDictionary(taskParameters, moduleInfo)))
            .pipe(gulpIf(hasLocalization, localizeXhtml(taskParameters, moduleInfo)))
            .pipe(gulpIf(hasLocalization || taskParameters.config.wml, buildTmpl(taskParameters, moduleInfo)))
            .pipe(gulpIf(taskParameters.config.deprecatedXhtml, buildXhtml(taskParameters, moduleInfo)))

            /**
             * packLibrary зависит от addComponentInfo, поскольку нам
             * необходимо правильно записать в кэш информацию о зависимостях
             * запакованной библиотеки, что нужно делать именно после парсинга
             * оригинальной скомпиленной библиотеки.
             * Также в библиотеках нужен кэш шаблонов, чтобы паковать приватные части шаблонов.
             */
            .pipe(gulpIf(taskParameters.config.minimize, packLibrary(taskParameters, moduleInfo)))

            // packOwnDeps зависит от buildTmp  l, buildXhtml
            .pipe(
               gulpIf(
                  taskParameters.config.deprecatedOwnDependencies,
                  packOwnDeps(taskParameters, moduleInfo)
               )
            )
            .pipe(gulpIf(taskParameters.config.minimize, minifyCss(taskParameters, moduleInfo)))

            // minifyJs зависит от packOwnDeps
            .pipe(gulpIf(taskParameters.config.minimize, minifyJs(taskParameters, moduleInfo)))
            .pipe(gulpIf(taskParameters.config.minimize, minifyOther(taskParameters, moduleInfo)))

            // createVersionedModules и createCdnModules зависит от versionizeToStub
            .pipe(gulpIf(!!taskParameters.config.version, createVersionedModules(taskParameters, moduleInfo)))
            .pipe(gulpIf(!!taskParameters.config.version, createCdnModules(taskParameters, moduleInfo)))
            .pipe(
               gulpRename((file) => {
                  file.dirname = transliterate(file.dirname);
                  file.basename = transliterate(file.basename);
               })
            )
            .pipe(
               gulpIf(
                  taskParameters.config.presentationServiceMeta,
                  createRoutesInfoJson(taskParameters, moduleInfo)
               )
            )
            .pipe(gulpIf(taskParameters.config.presentationServiceMeta, createNavigationModulesJson(moduleInfo)))

            // createContentsJson зависит от buildStaticHtml и addComponentInfo
            .pipe(gulpIf(taskParameters.config.contents, createContentsJson(taskParameters, moduleInfo)))
            .pipe(gulpIf(taskParameters.config.customPack, createLibrariesJson(taskParameters, moduleInfo)))

            // createStaticTemplatesJson зависит от buildStaticHtml и gulpBuildHtmlTmpl
            .pipe(gulpIf(taskParameters.config.presentationServiceMeta, createStaticTemplatesJson(moduleInfo)))
            .pipe(
               gulpIf(
                  taskParameters.config.dependenciesGraph || taskParameters.config.customPack ||
                  taskParameters.config.deprecatedStaticHtml,
                  createModuleDependenciesJson(taskParameters, moduleInfo)
               )
            )
            .pipe(filterCached(moduleInfo))
            .pipe(gulpIf(taskParameters.config.isSourcesOutput, filterSources()))
            .pipe(gulpIf(!taskParameters.config.sources, copySources(taskParameters, moduleInfo)))
            .pipe(gulpChmod({ read: true, write: true }))
            .pipe(
               gulpIf(
                  needSymlink(taskParameters.config, moduleInfo),
                  gulp.symlink(moduleInfo.output),
                  gulp.dest(moduleInfo.output)
               )
            )
      );
   };
}

module.exports = generateTaskForBuildModules;
