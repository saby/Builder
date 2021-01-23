'use strict';

const
   path = require('path'),
   helpers = require('../helpers'),
   less = require('less'),
   autoprefixer = require('autoprefixer'),
   postcss = require('postcss'),
   postcssCssVariables = require('postcss-css-variables'),
   postcssSafeParser = require('postcss-safe-parser'),
   CleanCSS = require('clean-css');

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
   if (gulpModulesPaths.hasOwnProperty(theme.moduleName)) {
      return `@import '${helpers.unixifyPath(path.join(theme.path, '_variables'))}';`;
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
async function getCompiledLess(lessContent, filePath, pathsForImport, imports, postCssOptions) {
   const { autoprefixerOptions, cssVariablesOptions, isThemeLess } = postCssOptions;
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

   const postCssProcessors = [];
   if (autoprefixerOptions) {
      postCssProcessors.push(autoprefixer(autoprefixerOptions));
   }
   if (cssVariablesOptions) {
      postCssProcessors.push(postcssCssVariables(cssVariablesOptions));
   }

   /**
    * post-process less result if there are any postcss
    * processors awaiting for css to be processed in it
    */
   if (postCssProcessors.length > 0) {
      const processor = postcss(postCssProcessors);
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

   /**
    * It's essential css optimizer for themes styles
    * that uses to merge equal css selectors and get rid of
    * duplicates - css selectors has equal names and about
    * 80% properties in common, but 20% differs, therefore about
    * 80% of css content is useless and can be removed to optimize
    * loading of styles on a client side.
    */
   if (isThemeLess) {
      const options = {

         /**
          * on 2nd level of optimization clean-css
          * merges css selectors and create 1 common
          * selector with a whole set of properties
          * from all merged selectors
          */
         level: 2,

         /**
          * these options are needed to get a debug
          * version of css file, it'll be minified
          * further for a release mode
          */
         format: {
            breaks: {
               afterAtRule: true,
               afterBlockBegins: true,
               afterBlockEnds: true,
               afterComment: true,
               afterProperty: true,
               afterRuleBegins: true,
               afterRuleEnds: true,
               beforeBlockEnds: true,
               betweenSelectors: true
            },
            breakWith: '\n',
            indentBy: 3,
            indentWith: 'space',
            spaces: {
               aroundSelectorRelation: true,
               beforeBlockBegins: true,
               beforeValue: true
            },
            wrapAt: false
         }
      };
      const compiled = new CleanCSS(options).minify(Buffer.from(result));
      let errors = [];
      if (compiled.errors.length) {
         errors = [...compiled.errors];
      }

      if (compiled.warnings.length) {
         errors = [...errors, ...compiled.warnings];
      }
      if (errors.length > 0) {
         throw new Error(`Theme optimizing was completed with errors: ${errors}`);
      } else {
         result = compiled.styles;
      }
   }

   return {
      text: result,
      imports: outputLess.imports,
      importedByBuilder: imports
   };
}

/**
 * check current file to be an old theme less(f.e. online.less, carry.less, etc.)
 * @param filePath
 * @param theme
 * @returns {Sinon.SinonMatcher | * | boolean}
 */
function isOldThemeLess(filePath, theme) {
   const relativeThemePath = `${helpers.unixifyPath(path.join(theme.path, theme.name))}.less`;
   return filePath.endsWith(relativeThemePath);
}

/**
 * Returns imports from builder for current less.
 * build less files without any extra imports from builder in next cases:
 * 1) for new themes
 * 2) for old theme less building(f.e. online.less, presto.less, etc.)
 * @param filePath
 * @param theme
 * @param gulpModulesPaths
 * @returns {Array}
 */
function getCurrentImports(filePath, themeProps, gulpModulesPaths) {
   const { newThemesModule, theme } = themeProps;
   if (!theme) {
      return [];
   }

   /**
    * theme object can be defined without path for it. Example - default theme resolved as 'online'(for old theme build
    * theme resolves to online as default), but interface module 'SBIS3.CONTROLS'(source of theme online) doenst exists
    * in current project.
    */
   if (newThemesModule) {
      if (gulpModulesPaths.hasOwnProperty('SBIS3.CONTROLS')) {
         return ['@import "SBIS3.CONTROLS/themes/_builderCompatibility";'];
      }
      return [];
   }

   if (isOldThemeLess(filePath, theme)) {
      return [];
   }

   const imports = [];

   const themeImport = getThemeImport(gulpModulesPaths, theme);
   if (themeImport) {
      imports.push(themeImport);
   }
   if (gulpModulesPaths.hasOwnProperty('SBIS3.CONTROLS')) {
      imports.push('@import "SBIS3.CONTROLS/themes/_mixins";');
   }
   imports.push(`@themeName: ${theme.name};`);
   return imports;
}

async function processLessFile(
   data,
   filePath,
   themeProps,
   gulpModulesInfo,
   postCssOptions = {
      autoprefixerOptions: {}, cssVariablesOptions: {}, isThemeLess: false
   }
) {
   const { pathsForImport, gulpModulesPaths } = gulpModulesInfo;
   const imports = getCurrentImports(filePath, themeProps, gulpModulesPaths);

   const newData = [...imports, ...[data]].join('\n');
   let lessResult;
   try {
      lessResult = await getCompiledLess(newData, filePath, pathsForImport, imports, postCssOptions);
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
          * file that has failed to be imported isn't existing in current error only
          * if less compiler have failed by itself
          */
         if (!error.filename) {
            return {
               error: error.message,
               compilerError: true
            };
         }

         if (error.type === 'File') {
            return {
               error: `${errorLineStr}: ${error.message}`,
               failedLess: error.filename,
               type: 'import'
            };
         }

         /**
          * error.filename can be somewhere in less files to be imported.
          * Therefore there is unique information for each failed less.
          */
         let message = 'Error compiling less ';
         message += `: ${errorLineStr}: ${error.message} Needed by ${filePath}`;
         return {
            error: message,
            failedLess: error.filename,
            type: 'common'
         };
      }
      throw error;
   }
   return lessResult;
}

module.exports = {
   getCurrentImports,
   processLessFile
};
