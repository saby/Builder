/**
 * Plugin for new themes less compiler
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   helpers = require('../../../lib/helpers'),
   { getThemeModifier } = require('../generate-task/collect-style-themes'),
   { defaultAutoprefixerOptions } = require('../../../lib/builder-constants');

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
 * Gets proper theme modificator for current building less. If modifier doesnt exists in theme
 * modifiers list, empty string will be returned.
 * Example:
 * Module has 2 themes:
 * 1)online - TestModule-online-theme/_theme.less
 * 2)online:dark-large - TestModule-online-theme/dark-large/_theme.less
 * For less TestModule-online-theme/dark-large/someDirectory/test.less
 * correct modifier must be "dark-large".
 * For less TestModule-online-theme/someDirectory/test.less
 * correct modifier must be "".
 * @param{String} themeModifier - resolved modifier for less
 * @param{String} moduleModifiers - current theme modifiers list
 * @returns {string}
 */
function getThemeModificatorForLess(themeModifier, moduleModifiers) {
   // themeModifier will be empty for root themed less
   if (!themeModifier) {
      return '';
   }
   let result = '';
   let currentThemeModifier = themeModifier;
   while (currentThemeModifier !== '.' && !result) {
      if (moduleModifiers.includes(currentThemeModifier)) {
         result = currentThemeModifier;
      }
      currentThemeModifier = path.dirname(currentThemeModifier);
   }
   return result;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {string[]} pathsForImport пути, в которыи less будет искать импорты. нужно для работы межмодульных импортов.
 * @returns {stream}
 */
function compileNewLess(taskParameters, moduleInfo, gulpModulesInfo) {
   const getOutput = function(file, replacingExt) {
      const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(/\.less$/, replacingExt);
      return path.join(moduleInfo.output, transliterate(relativePath));
   };
   const moduleName = path.basename(moduleInfo.output);

   const newThemes = taskParameters.cache.currentStore.themeModules;
   const currentModuleNewTheme = taskParameters.cache.getNewStyleTheme(moduleInfo.name);
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

   const defaultPipe = through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      }
   );

   // skip everything except new themes interface modules.
   if (!newThemes[moduleName]) {
      return defaultPipe;
   }

   //
   if (!newThemes[moduleName].moduleName) {
      logger.error({
         message: `For theme module ${moduleName} properly building you must also specify origin interface module!`,
         moduleInfo
      });
      return defaultPipe;
   }

   const errorsList = {};
   let errors = false;
   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (file.extname !== '.less') {
               callback(null, file);
               return;
            }

            /**
             * log information about empty less files. Developers should get
             * rid of empty and unused source files for avoiding of creating a dump
             * in theirs repos.
             */
            if (file.contents.length === 0) {
               logger.warning({
                  message: 'Empty less file is discovered. Please, remove it and appropriate imports of it in other less files',
                  filePath: file.path,
                  moduleInfo
               });
               callback(null, file);
               return;
            }

            const isPrivateLess = file.basename.startsWith('_');

            /**
             * private less files are used only for imports into another less, so we can
             * ignore them and return as common file into gulp stream
             */
            if (isPrivateLess) {
               callback(null, file);
               return;
            }

            /**
             * store every building less from new theme's interface modules
             * into builder cache to store theme into "contents" builder meta info
             */
            const themeModifier = getThemeModificatorForLess(
               getThemeModifier(moduleInfo.path, file.path),
               currentModuleNewTheme.modifiers
            );
            const relativePathByModifier = path.relative(
               path.join(moduleInfo.path, themeModifier),
               file.path
            );
            const currentLessName = relativePathByModifier.replace('.less', '');
            taskParameters.cache.storeNewThemesModules(
               newThemes[moduleName].moduleName,
               currentLessName,
               themeModifier,
               newThemes[moduleName].themeName
            );
            const outputCssFile = getOutput(file, '.css');

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], outputCssFile, moduleInfo);
               callback(null, file);
               return;
            }

            const lessInfo = {
               filePath: file.history[0],
               modulePath: moduleInfo.path,
               text: file.contents.toString(),
               newThemes,
               autoprefixerOptions
            };
            const [error, result] = await execInPool(
               taskParameters.pool,
               'buildNewLess',
               [
                  lessInfo,
                  gulpModulesInfo
               ],
               file.history[0],
               moduleInfo
            );
            if (error) {
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  message: 'Uncaught new less compiler error',
                  error,
                  filePath: file.history[0]
               });
               return;
            }
            taskParameters.storePluginTime('new less compiler', result.passedTime, true);
            if (result.error) {
               if (result.type) {
                  const moduleNameForFail = getModuleNameForFailedImportLess(
                     file.base,
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
                        `for existing in current project. Needed by: ${file.history[0]}.\n${errorLoadAttempts}`;
                  }
                  errorsList[result.failedLess] = {
                     message,
                     moduleInfo: moduleInfoForFail
                  };
               } else {
                  const message = `Less compiler error: ${result.error}. Source file: ${file.history[0]}.\n`;
                  logger.error({ message });
               }
               errors = true;
               taskParameters.cache.markFileAsFailed(file.history[0]);
            } else {
               const { compiled } = result;

               taskParameters.cache.addOutputFile(file.history[0], outputCssFile, moduleInfo);
               taskParameters.cache.addDependencies(file.history[0], compiled.imports);

               const newFile = file.clone();
               newFile.contents = Buffer.from(compiled.text);
               newFile.path = outputCssFile;
               newFile.base = moduleInfo.output;
               newFile.lessSource = file.contents;
               this.push(newFile);
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Builder plugin compile-new-less error',
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         /**
          * log error for current fallen less only once to avoid logs hell if error will be in one on theme's sources.
          */
         if (errors) {
            Object.keys(errorsList).forEach(
               failedLessFile => logger.error({ filePath: failedLessFile, ...errorsList[failedLessFile] })
            );
            logger.info(`Информация об Интерфейсных модулей для компилятора less: ${JSON.stringify(gulpModulesInfo)}`);
         }
         callback();
      }
   );
}

module.exports = {
   compileNewLess
};
