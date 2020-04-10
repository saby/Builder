/**
 * Search of all themes of styles in current project.
 * Themes will be searched and filtered by this template:
 * {Interface Module Name}/themes/{Theme name}/{Theme name}.less
 * Theme name will be set as a name of its folder.
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp'),
   path = require('path'),
   plumber = require('gulp-plumber'),
   mapStream = require('map-stream'),
   fs = require('fs-extra'),
   helpers = require('../../../lib/helpers'),
   configLessChecker = require('../../../lib/config-less-checker');

const logger = require('../../../lib/logger').logger();
const startTask = require('../../common/start-task-with-timer');
const permittedMultiThemes = require('../../../resources/multi-themes.json');

/**
 * Parses current interface module name. Checks it for new theme name template:
 * <first part> - <second part> - theme.
 * First part - interface module name, that exists in current project
 * Second part - theme name
 * Example: for interface module "Controls" with theme name "online" interface module
 * for this theme would be named to "Controls-online-theme"
 * Returns base theme info:
 * 1)moduleName - interface module name for current theme
 * 2)themeName - current theme name
 * @param{Set} modulesList - current project list of interface modules
 * @param{Array} currentModuleParts - parts of current interface module name
 * @returns {{themeName: string, moduleName: *}}
 */
function parseCurrentModuleName(modulesList, currentModuleParts) {
   const themeNameParts = [];
   let interfaceModuleParsed = false;
   while (!interfaceModuleParsed && currentModuleParts.length > 0) {
      themeNameParts.unshift(currentModuleParts.pop());
      if (modulesList.has(currentModuleParts.join('-'))) {
         interfaceModuleParsed = true;
      }
   }
   return {
      moduleName: currentModuleParts.join('-'),
      themeName: themeNameParts.join('-')
   };
}

/**
 * Gets new themes modifier by current theme module name and theme
 * definition less.
 * @param{String} modulePath - path to new theme interface module
 * @param{String} filePath - path to theme definition less
 * @returns {string}
 */
function getThemeModifier(modulePath, filePath) {
   const relativePath = path.relative(modulePath, filePath);
   const modifier = helpers.unixifyPath(path.dirname(relativePath));

   /**
    * for root theme relative path will be resolved as '.'
    * Set modifier as empty string in this case
    */
   return modifier === '.' ? '' : modifier;
}

/**
 * Генерация задачи поиска тем
 * @param {TaskParameters} taskParameters кеш сборки статики
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForCollectThemes(taskParameters) {
   if (!taskParameters.config.less) {
      return function skipCollectStyleThemes(done) {
         done();
      };
   }
   const buildModulesNames = new Set();
   taskParameters.config.modules.forEach(
      currentModule => buildModulesNames.add(path.basename(currentModule.output))
   );
   const tasks = taskParameters.config.modules.map((moduleInfo) => {
      const input = [
         path.join(moduleInfo.path, '/themes/*/*.less'),
         path.join(moduleInfo.path, '/themes.config.json'),
         path.join(moduleInfo.path, '/**/_theme.less')
      ];
      return function collectStyleThemes() {
         return gulp
            .src(input, { dot: false, nodir: true, allowEmpty: true })
            .pipe(
               plumber({
                  errorHandler(err) {
                     logger.error({
                        message: 'Задача collectStyleThemes завершилась с ошибкой',
                        error: err,
                        moduleInfo
                     });
                     this.emit('end');
                  }
               })
            )
            .pipe(mapStream(async(file, done) => {
               const currentFileName = path.basename(file.path);
               if (currentFileName === 'themes.config.json') {
                  /**
                   * if "themes.config.json" config file was found, log it as warning
                   * so folks responsible for project building can write errors
                   * for this to fix it and dont miss any of the config file.
                   */
                  logger.warning({
                     message: '"themes.config.json" is deprecated. You have to get rid of it.',
                     filePath: file.path
                  });
                  try {
                     const parsedLessConfig = JSON.parse(file.contents);
                     configLessChecker.checkOptions(parsedLessConfig);

                     // disable old less in less config if disabled for all project
                     if (!taskParameters.config.oldThemes) {
                        parsedLessConfig.old = false;
                     }
                     await taskParameters.cache.addModuleLessConfiguration(
                        moduleInfo.name,
                        parsedLessConfig,
                        taskParameters.config.rawConfig.cache
                     );
                  } catch (error) {
                     logger.error({
                        message: 'Ошибка обработки файла конфигурации less для Интерфейсного модуля',
                        error,
                        filePath: file.path,
                        moduleInfo
                     });
                  }
               } else if (currentFileName === '_theme.less') {
                  const currentModuleName = path.basename(moduleInfo.output);
                  const currentModuleNameParts = currentModuleName.split('-');

                  /**
                   * Interface module name for new theme should always contains 3 parts:
                   * 1)Interface module name for current theme
                   * 2)Current theme name
                   * 3) "theme" postfix
                   * Other Interface modules will be ignored from new theme's processing
                   */
                  if (currentModuleNameParts.length > 2 && currentModuleNameParts.pop() === 'theme') {
                     const themeModule = path.basename(moduleInfo.output);
                     const result = parseCurrentModuleName(buildModulesNames, currentModuleNameParts);
                     const modifier = getThemeModifier(
                        helpers.unixifyPath(moduleInfo.path),
                        helpers.unixifyPath(file.path),
                     );
                     taskParameters.cache.addNewStyleTheme(themeModule, modifier, result);
                  }
               } else {
                  const fileName = path.basename(file.path, '.less');
                  const folderName = path.basename(path.dirname(file.path));
                  if (fileName === folderName) {
                     if (permittedMultiThemes.includes(fileName)) {
                        const themeConfigPath = `${path.dirname(file.path)}/theme.config.json`;
                        let themeConfig;
                        if (!(await fs.pathExists(themeConfigPath))) {
                           logger.warning(`There is no configuration file ${themeConfigPath} with set of compatibility tags ` +
                              `for theme ${file.path}. This theme won't be participating in less build.`);
                        } else {
                           /**
                            * if "theme.config.json" config file was found, log it as warning
                            * so folks responsible for project building can write errors
                            * for this to fix it and dont miss any of the config file.
                            */
                           logger.warning({
                              message: '"theme.config.json" is deprecated. You have to get rid of it.',
                              filePath: file.path
                           });
                           try {
                              themeConfig = await fs.readJson(themeConfigPath);
                           } catch (error) {
                              logger.error({
                                 message: 'Theme configuration file error occurred. Check validity of the configuration file',
                                 error,
                                 filePath: themeConfigPath,
                                 moduleInfo
                              });
                           }
                        }
                        taskParameters.cache.addStyleTheme(folderName, path.dirname(file.path), themeConfig);
                     } else {
                        logger.error({
                           message: 'Attempt of defining multi theme. Please, use new themes scheme by defining of an appropriate interface module.',
                           filePath: file.path
                        });
                     }
                  }
               }
               done();
            }));
      };
   });

   const collectStyleThemes = startTask(
      'collectStyleThemes',
      taskParameters,
      null,
      () => taskParameters.cache.checkThemesForUpdate
   );
   return gulp.series(
      collectStyleThemes.start,
      gulp.parallel(tasks),
      collectStyleThemes.finish
   );
}

module.exports = {
   generateTaskForCollectThemes,
   parseCurrentModuleName,
   getThemeModifier
};
