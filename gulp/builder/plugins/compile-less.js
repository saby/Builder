/**
 * Plugin for compiling of less files
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   fs = require('fs-extra'),
   { defaultAutoprefixerOptions } = require('../../../lib/builder-constants'),
   cssExt = /\.css$/;

/**
 * Checks whether file should be built or skipped.
 * @param{String} relativePath - relative path from interface module root
 * @param{ModuleInfo} moduleInfo - info about current less interface module
 * @param{Object|boolean} themes - current project themes list. If true, all themes are enabled
 * in current project
 * @returns {boolean}
 */
function lessCanBeBuilt(relativePath, moduleInfo, themes) {
   // if themes checked as "true", build all of incoming less files
   if (themes && typeof themes === 'boolean') {
      return true;
   }

   // a regular less always can be built
   if (!moduleInfo.newThemesModule) {
      return true;
   }

   // dont build any less of current interface module if
   // there is no a corresponding theme in a current project
   if (!themes.hasOwnProperty(moduleInfo.themeName)) {
      return false;
   }

   // for non-array values of current theme(can be only "true" value) always build any less
   //  of current interface module
   if (themes[moduleInfo.themeName] && !themes[moduleInfo.themeName].length) {
      return true;
   }

   const relativePathParts = relativePath.split(path.sep);
   const firstName = relativePathParts[0];

   // build less if it's a root less and there is an
   // empty modifier of a current theme in a current project
   if (firstName.endsWith('.less') && themes[moduleInfo.themeName].includes('')) {
      return true;
   }

   if (themes[moduleInfo.themeName].includes(firstName) || !moduleInfo.modifiers.includes(firstName)) {
      return true;
   }

   return false;
}

function getRelativePath(modulePath, filePath) {
   return path.join(
      path.basename(modulePath),
      path.relative(modulePath, filePath)
   );
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters a whole parameters list for execution of build of current project
 * @param {ModuleInfo} moduleInfo all needed information about current interface module
 * @param {string[]} gulpModulesInfo paths to be used by less compiler for finding of imports.
 * Needed for proper work of trans-module imports
 * @returns {stream}
 */
function compileLess(taskParameters, moduleInfo, gulpModulesInfo) {
   const getOutput = function(file, replacingExt) {
      const relativePath = path.relative(moduleInfo.path, file.history[0]).replace(/\.less$/, replacingExt);
      return path.join(moduleInfo.output, transliterate(relativePath));
   };
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

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!['.less', '.css'].includes(file.extname)) {
               callback(null, file);
               return;
            }

            /**
             * log information about empty less files. Developers should get
             * rid of empty and unused source files for avoiding of creating a dump
             * in theirs repos.
             */
            if (file.contents.length === 0) {
               const extension = file.extname.slice(1, file.extname.length);
               logger.warning({
                  message: `Empty ${extension} file is discovered. Please, remove it and appropriate imports of it in other less files`,
                  filePath: file.path,
                  moduleInfo
               });
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

            if (!lessCanBeBuilt(file.relative, moduleInfo, taskParameters.config.themes)) {
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

            let relativeFilePath;
            const isThemeLess = file.basename === 'theme.less';
            if (moduleInfo.newThemesModule && isThemeLess) {
               let modifier = '';
               relativeFilePath = getRelativePath(moduleInfo.path, file.history[0]).replace('.less', '');
               moduleInfo.modifiers.forEach((currentModifier) => {
                  // prevent situation when empty modifier passes check for current theme after the modifier was
                  // found, e.g. when modifier is "dark" , but "" modifier also pass check, we need to use "dark", then.
                  if (relativeFilePath === path.join(moduleInfo.name, currentModifier, path.sep, 'theme') && !modifier) {
                     modifier = currentModifier;
                  }
               });
               const resultThemeName = `${moduleInfo.themeName}${modifier ? `__${modifier}` : ''}`;
               taskParameters.cache.addThemePartIntoMeta(resultThemeName, relativeFilePath, !file.cached);
               file.themeName = resultThemeName;
            }

            if (file.cached) {
               taskParameters.cache.addOutputFile(file.history[0], getOutput(file, '.css'), moduleInfo);
               callback(null, file);
               return;
            }

            relativeFilePath = getRelativePath(moduleInfo.path, file.history[0]);
            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.relative
               );
               const compiledPath = path.join(compiledSourcePath.replace('.less', '.css'));

               // for less there is only a symlink needed to be created, so we can get a result faster
               // due to avoid read of compiled css file
               if (taskParameters.cache.compareWithCompiled(relativeFilePath)) {
                  const newFile = file.clone();
                  const outputPath = getOutput(file, '.css');
                  newFile.path = outputPath;
                  newFile.base = moduleInfo.output;
                  if (!file.isLangCss) {
                     newFile.useSymlink = true;
                     newFile.origin = compiledPath;
                     newFile.compiledBase = compiledBase;
                  }
                  file.useSymlink = true;
                  this.push(newFile);
                  taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
                  taskParameters.cache.addDependencies(
                     moduleInfo.appRoot,
                     file.history[0],
                     taskParameters.cache.getCompiledDependencies(relativeFilePath) || []
                  );
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.history[0]}. It has to be compiled, then.`);
            }
            const [error, result] = await execInPool(
               taskParameters.pool,
               'buildLess',
               [
                  file.history[0],
                  file.contents.toString(),
                  moduleInfo.newThemesModule,
                  moduleInfo.path,
                  {
                     autoprefixerOptions,
                     cssVariablesOptions: taskParameters.cache.getCssVariablesoptions(),
                     isThemeLess
                  },
                  gulpModulesInfo
               ],
               file.history[0],
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
               taskParameters.cache.markFileAsFailed(file.history[0]);
               logger.error({
                  message: 'Uncaught less compiler error',
                  error,
                  filePath: file.history[0]
               });
               return;
            }

            taskParameters.storePluginTime('less compiler', result.passedTime, true);
            if (result.error) {
               if (result.type) {
                  let message = result.error;

                  // add more additional logs information for bad import in less
                  if (result.type === 'import') {
                     const errorLoadAttempts = result.error.slice(result.error.indexOf('Tried -'), result.error.length);
                     result.error = result.error.replace(errorLoadAttempts, '');

                     message = `Bad import detected ${result.error}. Check interface module of current import ` +
                        `for existing in current project. \n${errorLoadAttempts}`;
                  }
                  logger.error({
                     message,
                     filePath: file.history[0],
                     moduleInfo
                  });
               } else {
                  const messageParts = [];
                  messageParts.push(`Less compiler error: ${result.error}. Source file: ${file.history[0]}. `);
                  messageParts.push('\n');
                  logger.error({ message: messageParts.join('') });
               }
               taskParameters.cache.markFileAsFailed(file.history[0]);
            } else {
               const { compiled } = result;
               const outputPath = getOutput(file, '.css');
               taskParameters.cache.addOutputFile(file.history[0], outputPath, moduleInfo);
               taskParameters.cache.addDependencies(
                  moduleInfo.appRoot,
                  file.history[0],
                  compiled.imports
               );

               const newFile = file.clone();
               newFile.contents = Buffer.from(compiled.text);
               newFile.path = outputPath;
               newFile.base = moduleInfo.output;
               newFile.lessSource = file.contents;
               this.push(newFile);
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Builder error occurred in less compiler',
               error,
               moduleInfo,
               filePath: file.history[0]
            });
         }
         callback(null, file);
      }
   );
}

module.exports = compileLess;
