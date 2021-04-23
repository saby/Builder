/* eslint-disable no-sync */
/**
 * Генерирует поток выполнения сборки одного less файла при измении
 * Вызывается из WebStorm, например.
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path'),
   gulp = require('gulp'),
   gulpIf = require('gulp-if'),
   fs = require('fs-extra'),
   gulpRename = require('gulp-rename'),
   gulpChmod = require('gulp-chmod'),
   plumber = require('gulp-plumber'),
   helpers = require('../../lib/helpers'),
   startTask = require('../../gulp/common/start-task-with-timer'),
   mapStream = require('map-stream'),
   addComponentInfo = require('./plugins/add-component-info'),
   minifyCss = require('./plugins/minify-css'),
   minifyJs = require('./plugins/minify-js'),

   packLibrary = require('./plugins/pack-library'),
   minifyOther = require('./plugins/minify-other'),
   buildXhtml = require('./plugins/build-xhtml'),
   buildTmpl = require('./plugins/build-tmpl'),
   gulpBuildHtmlTmpl = require('./plugins/build-html-tmpl'),
   generateTaskForPrepareWS = require('../common/generate-task/prepare-ws');

const Cache = require('./classes/cache'),
   Configuration = require('./classes/configuration.js'),
   ConfigurationReader = require('../common/configuration-reader'),
   generateTaskForMarkThemeModules = require('./generate-task/mark-theme-modules'),
   TaskParameters = require('../common/classes/task-parameters'),
   compileLess = require('./plugins/compile-less'),
   compileEsAndTs = require('./plugins/compile-es-and-ts'),
   logger = require('../../lib/logger').logger(),
   transliterate = require('../../lib/transliterate'),
   pushChanges = require('../../lib/push-changes'),
   { generateDownloadModuleCache, generateSaveModuleCache } = require('./classes/modules-cache'),
   generateJoinedThemes = require('../../lib/save-themes');

const {
   needSymlink,
   generateTaskForLoadCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool
} = require('../common/helpers');

function getFilesToBuild(prettyRoot, filePath, themesParts, dependencies) {
   const filesToBuild = [filePath];
   const prettyFilePath = helpers.unixifyPath(filePath);
   const relativeFilePath = helpers.removeLeadingSlashes(
      prettyFilePath.replace(prettyRoot, '')
   );
   Object.keys(dependencies).forEach((currentFile) => {
      if (dependencies[currentFile].includes(relativeFilePath)) {
         const fullPath = path.join(prettyRoot, currentFile);
         filesToBuild.push(fullPath);
         if (path.basename(fullPath) === 'theme.less') {
            themesParts.push(currentFile);
         }
      }
   });
   if (path.basename(prettyFilePath) === 'theme.less' && !themesParts.includes(relativeFilePath)) {
      themesParts.push(relativeFilePath);
   }
   return filesToBuild;
}

// watcher's mini task for generating of themes.
function generateSaveThemesTask(taskParameters, themesParts) {
   return async function saveThemesMeta() {
      // don't waste time if there is no changes in themes parts
      if (themesParts.length > 0) {
         const root = taskParameters.config.rawConfig.output;
         const fileSuffix = taskParameters.config.isReleaseMode ? '.min' : null;
         const isThemeForReleaseOnly = !taskParameters.config.sources && taskParameters.config.isReleaseMode;
         const themesMeta = taskParameters.cache.getThemesMetaForWatcher();
         themesParts.forEach((currentThemePart) => {
            const themeName = themesMeta.themesMap[currentThemePart.replace('.less', '')];
            taskParameters.addChangedFile(`themes/${themeName}.css`);
            taskParameters.removeChangedFile(currentThemePart.replace('.less', '.css'));
         });
         const resourceRoot = `${taskParameters.config.applicationForRebase}${taskParameters.config.resourcesUrl ? 'resources/' : ''}`;
         await generateJoinedThemes(root, isThemeForReleaseOnly, fileSuffix, themesMeta.themes, resourceRoot);
      }
   };
}

/**
 * Генерирует поток выполнения сборки одного less файла при измении
 * @param {string[]} processArgv массив аргументов запуска утилиты
 * @returns {Undertaker.TaskFunction} gulp задача
 */
function generateBuildWorkflowOnChange(processArgv) {
   const { filePath, hotReloadPort } = ConfigurationReader.getProcessParameters(processArgv);

   // загрузка конфигурации должна быть синхронной, иначе не построятся задачи для сборки модулей
   const config = new Configuration();
   config.loadSync(processArgv);
   if (!filePath) {
      throw new Error('Не указан параметр --filePath');
   }

   // if hot reload port is selected by user, use it to push changes
   if (hotReloadPort) {
      config.staticServer = `localhost:${hotReloadPort}`;
   }

   const taskParameters = new TaskParameters(config, new Cache(config));

   // skip collectThemes task for non-less files rebuilding
   if (!filePath.endsWith('.less')) {
      taskParameters.config.less = false;
   }

   let currentModuleInfo;
   const pathsForImportSet = new Set();
   let filePathInProject = helpers.unixifyPath(filePath);
   const gulpModulesPaths = {};
   for (const moduleInfo of taskParameters.config.modules) {
      gulpModulesPaths[moduleInfo.name] = moduleInfo.path;
      if (!currentModuleInfo) {
         let relativePath = path.relative(
            helpers.unixifyPath(moduleInfo.path),
            helpers.unixifyPath(filePath)
         );

         // на windows если два файла на разных дисках, то path.relative даёт путь от диска, без ..
         if (!relativePath.includes('..') && !path.isAbsolute(relativePath)) {
            currentModuleInfo = moduleInfo;
         } else {
            /**
             * если модуль задан через симлинк, попробуем сопоставить файл и модуль
             * Также резолвим реальный путь на случай, если разработчики подрубают к вотчеру
             * Интерфейсные модули, описанные через симлинки.
             */
            const realModulePath = fs.realpathSync(moduleInfo.path);
            if (fs.existsSync(filePath)) {
               const realFilePath = fs.realpathSync(filePath);
               relativePath = path.relative(
                  helpers.unixifyPath(realModulePath),
                  helpers.unixifyPath(realFilePath)
               );
               if (!relativePath.includes('..') && !path.isAbsolute(relativePath)) {
                  currentModuleInfo = moduleInfo;
                  filePathInProject = helpers.unixifyPath(
                     path.join(moduleInfo.path, relativePath)
                  );
               }
            }
         }
      }
      pathsForImportSet.add(moduleInfo.appRoot);
   }
   const gulpModulesInfo = {
      pathsForImport: [...pathsForImportSet],
      gulpModulesPaths
   };

   if (!currentModuleInfo) {
      logger.info(`Файл ${filePathInProject} вне проекта`);
      return function skipWatcher(done) {
         done();
      };
   }

   // guardSingleProcess пришлось убрать из-за того что WebStorm может вызвать несколько процессов параллельно
   return gulp.series(
      generateTaskForLoadCache(taskParameters),
      generateTaskForCheckVersion(taskParameters),
      generateTaskForPrepareWS(
         taskParameters,
         currentModuleInfo,

         // prepareWS for current interface module needed only if there is a .ts or .js file for rebuild.
         filePath.endsWith('.ts') || filePath.endsWith('.js')
      ),
      generateTaskForInitWorkerPool(taskParameters),
      generateTaskForMarkThemeModules(taskParameters, config),
      generateTaskForBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject),
      generateTaskForPushOfChanges(taskParameters),
      generateTaskForTerminatePool(taskParameters)
   );
}

function generateTaskForPushOfChanges(taskParameters) {
   if (!taskParameters.config.staticServer) {
      return function skipPushOfChangedFiles(done) {
         done();
      };
   }
   return function pushOfChangedFiles() {
      return pushChanges(taskParameters);
   };
}

function generateTaskForBuildFile(taskParameters, currentModuleInfo, gulpModulesInfo, filePathInProject) {
   const themesParts = [];
   const currentModuleOutput = path.join(
      taskParameters.config.rawConfig.output,
      currentModuleInfo.runtimeModuleName
   );
   const buildModule = function buildModule() {
      const prettyRoot = helpers.unixifyPath(
         path.dirname(currentModuleInfo.path)
      );
      const filesToBuild = getFilesToBuild(
         prettyRoot,
         filePathInProject,
         themesParts,
         taskParameters.cache.getLastStoreDependencies()
      );
      logger.info(`These are files to be rebuilt: ${JSON.stringify(filesToBuild, null, 3)}`);
      return gulp
         .src(filesToBuild, { dot: false, nodir: true, base: currentModuleInfo.path })
         .pipe(
            plumber({
               errorHandler(err) {
                  logger.error({
                     message: 'Задача buildModule завершилась с ошибкой',
                     error: err,
                     currentModuleInfo
                  });
                  this.emit('end');
               }
            })
         )
         .pipe(compileEsAndTs(taskParameters, currentModuleInfo))
         .pipe(addComponentInfo(taskParameters, currentModuleInfo))
         .pipe(compileLess(taskParameters, currentModuleInfo, gulpModulesInfo))
         .pipe(gulpIf(taskParameters.config.htmlWml, gulpBuildHtmlTmpl(taskParameters, currentModuleInfo)))
         .pipe(
            gulpIf(
               (taskParameters.config.wml && taskParameters.config.isReleaseMode),
               buildTmpl(taskParameters, currentModuleInfo)
            )
         )
         .pipe(
            gulpIf(
               (taskParameters.config.deprecatedXhtml && taskParameters.config.isReleaseMode),
               buildXhtml(taskParameters, currentModuleInfo)
            )
         )
         .pipe(
            gulpRename((file) => {
               file.dirname = transliterate(file.dirname);
               file.basename = transliterate(file.basename);
            })
         )
         .pipe(gulpIf(taskParameters.config.minimize, packLibrary(taskParameters, currentModuleInfo)))
         .pipe(gulpIf(taskParameters.config.minimize, minifyCss(taskParameters, currentModuleInfo)))

         // minifyJs зависит от packOwnDeps
         .pipe(gulpIf(taskParameters.config.minimize, minifyJs(taskParameters, currentModuleInfo)))

         .pipe(gulpIf(taskParameters.config.minimize, minifyOther(taskParameters, currentModuleInfo)))
         .pipe(gulpChmod({ read: true, write: true }))
         .pipe(mapStream((file, callback) => {
            if (!['.ts', '.less'].includes(file.extname)) {
               // don't push information about minified files onto hot reload server, it's useless and
               // ruins debugging, because minified version overwrites debug version
               if (!path.basename(file.path).endsWith(`.min${file.extname}`)) {
                  const outputFilePath = path.join(
                     currentModuleInfo.runtimeModuleName,
                     file.relative
                  ).replace(/\\/g, '/');
                  taskParameters.addChangedFile(outputFilePath);
               }
            }
            callback(null, file);
         }))
         .pipe(
            gulpIf(
               needSymlink(taskParameters.config, currentModuleInfo),
               gulp.symlink(currentModuleInfo.output),
               gulp.dest(currentModuleInfo.output)
            )
         )
         .pipe(
            gulpIf(
               taskParameters.config.isReleaseMode,
               gulp.dest(currentModuleOutput)
            )
         );
   };
   const buildFile = startTask('buildModule', taskParameters);
   return gulp.series(
      buildFile.start,

      // set a sign of patch build to get a whole module cache
      // for instance, es compile cache and markup cache, for proper library packing
      generateDownloadModuleCache(taskParameters, currentModuleInfo, true),
      buildModule,
      generateSaveModuleCache(currentModuleInfo),
      generateSaveThemesTask(taskParameters, themesParts),
      buildFile.finish
   );
}
function generateTaskForCheckVersion(taskParameters) {
   return function checkBuilderVersion(done) {
      const lastVersion = taskParameters.cache.lastStore.versionOfBuilder,
         currentVersion = taskParameters.cache.currentStore.versionOfBuilder;
      if (lastVersion !== currentVersion) {
         logger.error(
            `Текущая версия Builder'а (${currentVersion}) не совпадает с версией, ` +
               `сохранённой в кеше (${lastVersion}). ` +
               'Вероятно, необходимо передеплоить стенд.'
         );
      }
      done();
   };
}
module.exports = generateBuildWorkflowOnChange;
