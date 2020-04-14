'use strict';

const
   path = require('path'),
   builderConstants = require('../builder-constants'),
   helpers = require('../helpers'),
   less = require('less'),
   autoprefixer = require('autoprefixer'),
   postcss = require('postcss'),
   postcssSafeParser = require('postcss-safe-parser');

/**
 * get variables import in dependency of:
 * 1) project has SBIS3.CONTROLS module:
 * 1.1) less config has variables option with value "Controls-default-theme":
 *    get import from Controls-default-theme
 * 1.2) in other cases get variables from SBIS3.CONTROLS.
 * 2) project don't have SBIS3.CONTROLS module
 * 1.1) get variables from Controls-default-theme if project has it.
 * 1.2) don't get variables if Controls-default-theme doesn't exists in current project
 */
function getThemeImport(gulpModulesPaths, theme) {
   const importLessName = builderConstants.oldThemes.includes(theme.name) ? '_variables' : theme.name;
   if (theme.isDefault && theme.variablesFromLessConfig === 'Controls-default-theme') {
      return "@import 'Controls-default-theme/_theme';";
   }
   if (theme.path) {
      if (theme.customPath) {
         return `@import '${helpers.unixifyPath(theme.path)}';`;
      }
      return `@import '${helpers.unixifyPath(path.join(theme.path, importLessName))}';`;
   }
   if (gulpModulesPaths.hasOwnProperty('Controls-default-theme')) {
      return "@import 'Controls-default-theme/_theme';";
   }
   return '';
}

/**
 * get compiler result for current less and post-process it with autoprefixer.
 * @param{String} lessContent - current less content
 * @param{String} filePath - path to current less
 * @param{Object} pathsForImport - meta data for interface modules physical paths
 * @param{Object} theme - current theme meta data
 * @param{Object} imports - current less imports added by builder
 */
async function getCompiledLess(lessContent, filePath, pathsForImport, theme, imports, autoprefixerOptions) {
   const outputLess = await less.render(lessContent, {
      filename: filePath,
      cleancss: false,
      relativeUrls: true,
      strictImports: true,

      // так предписывает делать документация для поддержки js в less
      inlineJavaScript: true,

      // а так работает на самом деле поддержка js в less
      javascriptEnabled: true,
      paths: pathsForImport
   });

   let result;

   /**
    * post-process less result if autoprefixer enabled
    */
   if (autoprefixerOptions) {
      const processor = postcss([
         autoprefixer(autoprefixerOptions)
      ]);
      const postCssResult = await processor.process(
         outputLess.css,
         {
            parser: postcssSafeParser,
            from: filePath
         }
      );
      result = postCssResult.css;
   } else {
      result = outputLess.css;
   }

   return {
      text: result,
      imports: outputLess.imports,
      nameTheme: theme.name,
      defaultTheme: theme.isDefault || theme.type === 'new',
      importedByBuilder: imports
   };
}

/**
 * Get correct import for mixins in depend of described cases:
 * 1) for old theme compiling we should use SBIS3.CONTROLS mixins import
 * 2) otherwise use Controls-default-theme mixins if current project build includes this interface module
 * @param{Object} gulpModulesPaths - all interface modules of current project with physical paths for each one
 * @param{Object} oldBuild - takes true if we are building less in old theme scheme
 * @returns {string}
 */
function getMixinImport(gulpModulesPaths, oldBuild) {
   if (gulpModulesPaths.hasOwnProperty('SBIS3.CONTROLS') && oldBuild) {
      return '@import "SBIS3.CONTROLS/themes/_mixins";';
   }
   if (gulpModulesPaths.hasOwnProperty('Controls-default-theme')) {
      return '@import "Controls-default-theme/_mixins";';
   }
   return '';
}

/**
 * Returns imports from builder for current less.
 * build less files without any extra imports from builder in next cases:
 * 1) for new themes
 * 2) for old theme less building(f.e. genie.less, online.less, presto.less, etc.)
 * @param filePath
 * @param theme
 * @param gulpModulesPaths
 * @returns {Array}
 */
function getCurrentImports(filePath, theme, gulpModulesPaths) {
   if (theme.type === 'new') {
      if (gulpModulesPaths.hasOwnProperty('SBIS3.CONTROLS')) {
         return ['@import \'SBIS3.Controls/themes/online/_variables\';'];
      }
      return [];
   }

   const imports = [];

   /**
    * theme object can be defined without path for it. Example - default theme resolved as 'online'(for old theme build
    * theme resolves to online as default), but interface module 'SBIS3.CONTROLS'(source of theme online) doenst exists
    * in current project.
    */
   if (theme.path && filePath === `${helpers.unixifyPath(path.join(theme.path, theme.name))}.less`) {
      return imports;
   }
   const variablesImport = getThemeImport(gulpModulesPaths, theme);
   if (variablesImport) {
      imports.push(variablesImport);
   }
   imports.push(getMixinImport(gulpModulesPaths, theme.isDefault));
   imports.push(`@themeName: ${theme.name};`);
   return imports;
}


async function processLessFile(data, filePath, theme, gulpModulesInfo, autoprefixerOptions) {
   const { pathsForImport, gulpModulesPaths } = gulpModulesInfo;
   const imports = getCurrentImports(filePath, theme, gulpModulesPaths);

   const newData = [...imports, ...[data]].join('\n');
   let lessResult;
   try {
      lessResult = await getCompiledLess(newData, filePath, pathsForImport, theme, imports, autoprefixerOptions);
   } catch (error) {
      if (error instanceof less.LessError) {
         // error.line может не существовать.
         let errorLineStr = '';
         if (error.hasOwnProperty('line') && typeof error.line === 'number') {
            let errorLine = error.line;
            if (
               helpers.prettifyPath(error.filename) === helpers.prettifyPath(filePath) &&
               errorLine >= imports.length
            ) {
               // сколько строк добавили в файл, столько и вычтем для вывода ошибки
               // в errorLine не должно быть отрицательных значений.
               errorLine -= imports.length;
            }
            errorLineStr = ` in line ${errorLine.toString()}`;
         }

         /**
          * failed file import will not be existing in current error only
          * in case of less compiler error
          */
         if (!error.filename) {
            return {
               error: error.message,
               compilerError: true,
               theme
            };
         }

         if (error.type === 'File') {
            return {
               error: `${errorLineStr}: ${error.message}`,
               failedLess: error.filename,
               type: 'import',
               theme
            };
         }

         /**
          * error.filename may be somewhere in less files to be imported.
          * Therefore there is unique information for each failed less.
          */
         let message = 'Error compiling less ';
         if (theme.name) {
            message += `for theme ${theme.name}(${theme.isDefault ? 'old' : 'multi'} theme type)`;
         }
         message += `: ${errorLineStr}: ${error.message} Needed by ${filePath}`;
         return {
            error: message,
            failedLess: error.filename,
            type: 'common',
            theme
         };
      }
      throw error;
   }
   return lessResult;
}

module.exports = {
   getThemeImport,
   getCurrentImports,
   processLessFile
};
