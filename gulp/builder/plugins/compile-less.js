/**
 * Плагин для компиляции less.
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   helpers = require('../../../lib/helpers'),
   fs = require('fs-extra'),
   { defaultAutoprefixerOptions } = require('../../../lib/builder-constants'),
   cssExt = /\.css$/;

/**
 * Получаем путь до скомпиленного css в конечной директории относительно
 * корня приложения.
 * @param {Object} moduleInfo - базовая информация об Интерфейсном модуле
 * @param {String} prettyFilePath - отформатированный путь до css-файла.
 * @returns {*}
 */
function getRelativeOutput(moduleInfo, prettyFilePath) {
   const { moduleName, prettyModuleOutput } = moduleInfo;
   const relativePath = path.relative(prettyModuleOutput, prettyFilePath);
   return path.join(moduleName, relativePath).replace(/\.css$/, '.min.css');
}

/**
 * Get interface module name from failed less path
 * @param{String} currentLessBase - path to current less interface module
 * @param{String} failedLessPath - full path to failed less
 * @returns {*}
 */
function getModuleNameForFailedImportLess(currentLessBase, failedLessPath) {
   const root = helpers.unixifyPath(path.dirname(currentLessBase));
   const prettyFailedLessPath = helpers.unixifyPath(failedLessPath);
   const prettyRelativePath = helpers.removeLeadingSlashes(
      prettyFailedLessPath.replace(root, '')
   );
   return prettyRelativePath.split('/').shift();
}

/**
 * В случае отсутствия в Интерфейсном модуле конфигурации темизации less
 * файлов, генерируем базовую конфигурацию:
 * 1) Генерируем все less-ки Интерфейсного модуля по старой схеме темизации
 * 2) Не билдим все less-ки Интерфейсного модуля по новой схеме темизации
 */
function setDefaultLessConfiguration() {
   return {
      old: true,
      multi: false
   };
}

/**
 * Check current theme for new theme type
 * @param{Object} currentTheme - current theme info
 * @returns {boolean}
 */
function checkForNewThemeType(currentTheme) {
   /**
    * new themes can't be imported into any less by builder,
    * only physically import is allowed for it.
    */
   return currentTheme.type === 'new';
}

/**
 * Gets themes list for multi themes build
 * configuration
 * @param allThemes
 * @param taskParameters
 */
function getMultiThemesList(allThemes, themesParam) {
   const multiThemes = {};
   switch (typeof themesParam) {
      case 'boolean':
         if (themesParam) {
            Object.keys(allThemes).forEach((currentTheme) => {
               if (checkForNewThemeType(allThemes[currentTheme])) {
                  return;
               }
               multiThemes[currentTheme] = allThemes[currentTheme];
            });
         }
         break;

      // selected array of themes
      case 'object':
         if (themesParam instanceof Array === true) {
            Object.keys(allThemes).forEach((currentTheme) => {
               if (themesParam.includes(currentTheme)) {
                  if (checkForNewThemeType(allThemes[currentTheme])) {
                     return;
                  }
                  multiThemes[currentTheme] = allThemes[currentTheme];
               }
            });
         }
         break;
      default:
         break;
   }
   return multiThemes;
}

/**
 * gets new themes list
 * @param allThemes
 */
function getNewThemesList(allThemes) {
   const newThemes = {};
   Object.keys(allThemes).forEach((currentTheme) => {
      if (allThemes[currentTheme].type === 'new') {
         newThemes[currentTheme] = allThemes[currentTheme];
      }
   });
   return newThemes;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {string[]} pathsForImport пути, в которыи less будет искать импорты. нужно для работы межмодульных импортов.
 * @returns {stream}
 */
function compileLess(taskParameters, moduleInfo, gulpModulesInfo) {
   const getOutput = function(file, replacingExt) {
      const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(/\.less$/, replacingExt);
      return path.join(moduleInfo.output, transliterate(relativePath));
   };
   const moduleLess = [];
   const allThemes = taskParameters.cache.currentStore.styleThemes;
   const moduleName = path.basename(moduleInfo.output);

   // check for offline plugin application
   const multiThemes = getMultiThemesList(allThemes, taskParameters.config.themes);
   const newThemes = getNewThemesList(allThemes);
   let autoprefixerOptions = false;
   switch (typeof taskParameters.config.autoprefixer) {
      case 'boolean':
         if (taskParameters.config.autoprefixer) {
            // set default by builder autoprefixer options
            autoprefixerOptions = defaultAutoprefixerOptions;
         } else {
            autoprefixerOptions = false;
         }
         break;
      case 'object':
         if (!(taskParameters.config.autoprefixer instanceof Array)) {
            autoprefixerOptions = taskParameters.config.autoprefixer;
         }
         break;
      default:
         break;
   }

   /**
    * skip new themes interface modules. Gulp have own plugin for this situation.
    */
   if (newThemes[moduleName]) {
      return through.obj(
         function onTransform(file, encoding, callback) {
            callback(null, file);
         }
      );
   }

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!['.less', '.css'].includes(file.extname)) {
               callback(null, file);
               return;
            }

            /**
             * private less files are used only for imports into another less, so we can
             * ignore them and return as common file into gulp stream
             */
            if (file.basename.startsWith('_')) {
               callback(null, file);
               return;
            }

            /**
             * always ignore css source files if the same .less source files exists
             */
            if (file.extname === '.css') {
               const lessInSource = await fs.pathExists(file.path.replace(cssExt, '.less'));
               if (lessInSource) {
                  const
                     warnMessage = 'Compiled style from sources will be ignored: ' +
                     'current style will be compiled from less source analog',
                     logObj = {
                        message: warnMessage,
                        filePath: file.path,
                        moduleInfo
                     };

                  /**
                   * for local stands building in debug mode log existing css messages as info for debug.
                   * In other cases log it as warnings to ensure for build department to handle this
                   * messages and report an error for responsible employees
                   */
                  if (taskParameters.config.isReleaseMode) {
                     logger.warning(logObj);
                  } else {
                     logger.debug(logObj);
                  }
                  callback(null);
                  return;
               }
               callback(null, file);
               return;
            }

            let isLangCss = false;

            if (moduleInfo.contents.availableLanguage) {
               const avlLang = Object.keys(moduleInfo.contents.availableLanguage);
               isLangCss = avlLang.includes(file.basename.replace('.less', ''));
               file.isLangCss = isLangCss;
            }

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], getOutput(file, '.css'), moduleInfo);

               if (!isLangCss) {
                  Object.keys(allThemes).forEach((key) => {
                     taskParameters.cache.addOutputFile(file.history[0], getOutput(file, `_${key}.css`), moduleInfo);
                  });
               }

               callback(null, file);
               return;
            }

            moduleLess.push(file);
            callback(null);
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Ошибка builder\'а при сборе less-файлов',
               error,
               moduleInfo,
               filePath: file.history[0]
            });
            callback(null, file);
         }
      },

      /* @this Stream */
      async function onFlush(callback) {
         let moduleLessConfig = taskParameters.cache.getModuleLessConfiguration(moduleInfo.name);
         if (!moduleLessConfig) {
            moduleLessConfig = setDefaultLessConfiguration();
         }
         const
            prettyModuleOutput = helpers.prettifyPath(moduleInfo.output),
            needSaveImportLogs = taskParameters.config.logFolder && moduleLessConfig.importsLogger;

         let compiledLess = new Set();

         /**
          * если уже существует мета-файл по результатам предыдущей сборки, необходимо
          * прочитать его и дополнить новыми скомпилированными стилями.
          */
         if (await fs.pathExists(path.join(moduleInfo.output, '.builder/compiled-less.min.json'))) {
            compiledLess = new Set(await fs.readJson(path.join(moduleInfo.output, '.builder/compiled-less.min.json')));
         }

         /**
          * Если разработчиком в конфигурации less задан параметр для логгирования импортов для
          * компилируемого less, создаём json-лог и пишем его в директорию логов с названием соответствующего
          * Интерфейсного модуля. Если такой лог уже существует, предварительно вычитываем его и меняем набор
          * импортов изменённых less(для инкрементальной сборки).
          */
         let lessImportsLogs = {}, lessImportsLogsPath;
         if (needSaveImportLogs) {
            lessImportsLogsPath = path.join(taskParameters.config.logFolder, `less-imports-for-${moduleName}.json`);
            if (await fs.pathExists(lessImportsLogsPath)) {
               lessImportsLogs = await fs.readJson(lessImportsLogsPath);
            }
         }
         let errors = false;
         const promises = [];
         const errorsList = {};
         Object.keys(moduleLess).forEach((lessFile) => {
            promises.push((async(currentLessFile) => {
               try {
                  const lessInfo = {
                     filePath: currentLessFile.history[0],
                     modulePath: moduleInfo.path,
                     text: currentLessFile.contents.toString(),
                     moduleLessConfig,
                     multiThemes,
                     autoprefixerOptions
                  };
                  const [error, results] = await execInPool(
                     taskParameters.pool,
                     'buildLess',
                     [
                        lessInfo,
                        gulpModulesInfo,
                        currentLessFile.isLangCss,
                        allThemes
                     ],
                     currentLessFile.history[0],
                     moduleInfo,

                     /**
                      * for some project in one execute machine builder can be used multiple times in parallel -
                      * f.e. in offline desktop application building debug and release versions of current product.
                      * In this case will be created 2x more node.js workers, than we have CPU threads in current
                      * machine, that would cause "resources war" between 2 builder workerpools and significant
                      * performance decrease. In this case we need extra timeout for heavy tasks
                      * (less compiler is the heaviest of all builder tasks for worker)
                      */
                     600000
                  );
                  if (error) {
                     taskParameters.cache.markFileAsFailed(currentLessFile.history[0]);
                     logger.error({
                        message: 'Uncaught less compiler error',
                        error,
                        filePath: currentLessFile.history[0]
                     });
                     return;
                  }

                  for (const result of results) {
                     taskParameters.storePluginTime('less compiler', result.passedTime, true);
                     if (result.error) {
                        if (result.type) {
                           const moduleNameForFail = getModuleNameForFailedImportLess(
                              currentLessFile.base,
                              result.failedLess
                           );
                           const moduleInfoForFail = taskParameters.config.modules.find(
                              currentModuleInfo => currentModuleInfo.name === moduleNameForFail
                           );
                           let message = result.error;

                           // add more additional logs information for bad import in less
                           if (result.type === 'import') {
                              const errorLoadAttempts = result.error.slice(result.error.indexOf('Tried -'), result.error.length);
                              result.error = result.error.replace(errorLoadAttempts, '');

                              message = `Bad import detected ${result.error}. Check interface module of current import ` +
                                 `for existing in current project. Needed by: ${currentLessFile.history[0]}. ` +
                                 `For theme: ${result.theme.name}. Theme type: ${result.theme.isDefault ? 'old' : 'new'}\n${errorLoadAttempts}`;
                           }
                           errorsList[result.failedLess] = {
                              message,
                              moduleInfo: moduleInfoForFail
                           };
                        } else {
                           const messageParts = [];
                           messageParts.push(`Less compiler error: ${result.error}. Source file: ${currentLessFile.history[0]}. `);
                           if (result.theme) {
                              messageParts.push(`Theme: ${result.theme.name}. `);
                              messageParts.push(`Theme type: ${result.theme.isDefault ? 'old' : 'new'}`);
                           }
                           messageParts.push('\n');
                           logger.error({ message: messageParts.join('') });
                        }
                        errors = true;
                        taskParameters.cache.markFileAsFailed(currentLessFile.history[0]);
                     } else {
                        const { compiled } = result;
                        const outputPath = getOutput(currentLessFile, compiled.defaultTheme ? '.css' : `_${compiled.nameTheme}.css`);

                        /**
                         * Мета-данные о скомпилированных less нужны только во время
                         * выполнения кастомной паковки
                         */
                        if (taskParameters.config.customPack) {
                           const relativeOutput = helpers.unixifyPath(
                              getRelativeOutput(
                                 { moduleName, prettyModuleOutput },
                                 helpers.unixifyPath(outputPath)
                              )
                           );
                           compiledLess.add(relativeOutput);
                        }
                        taskParameters.cache.addOutputFile(currentLessFile.history[0], outputPath, moduleInfo);
                        taskParameters.cache.addDependencies(currentLessFile.history[0], compiled.imports);

                        const newFile = currentLessFile.clone();
                        newFile.contents = Buffer.from(compiled.text);
                        newFile.path = outputPath;
                        newFile.base = moduleInfo.output;
                        newFile.lessSource = currentLessFile.contents;
                        this.push(newFile);

                        if (needSaveImportLogs) {
                           lessImportsLogs[outputPath] = {
                              importedByBuilder: compiled.importedByBuilder,
                              allImports: compiled.imports
                           };
                        }
                     }
                  }
               } catch (error) {
                  taskParameters.cache.markFileAsFailed(currentLessFile.history[0]);
                  logger.error({
                     message: 'Builder error occurred in less compiler',
                     error,
                     filePath: currentLessFile.history[0]
                  });
               }
               this.push(currentLessFile);
            })(moduleLess[lessFile]));
         });
         await Promise.all(promises);

         /**
          * do logging errors of current errored less for once to avoid hell of logs
          * in case of error had been occured by sort of theme's source.
          */
         if (errors) {
            Object.keys(errorsList).forEach(
               failedLessFile => logger.error({ filePath: failedLessFile, ...errorsList[failedLessFile] })
            );
            logger.info(`Information about interface modules used by less compiler during the build: ${JSON.stringify(gulpModulesInfo)}`);
         }
         if (taskParameters.config.customPack) {
            /**
             * Because there is a possibility of writing compiled-less meta in SDK(this one is strictly
             * forbidden on UNIX-based OS without a special permission - sudo),
             * we'll write it in output folder directly and immediately by using "fs" library instead of "Vinyl"
             */
            await fs.outputJson(
               path.join(moduleInfo.output, '.builder/compiled-less.min.json'),
               [...compiledLess].sort()
            );
         }

         if (needSaveImportLogs) {
            await fs.outputJson(lessImportsLogsPath, lessImportsLogs);
         }
         callback();
      }
   );
}

module.exports = {
   compileLess,
   getMultiThemesList,
   checkForNewThemeType
};
