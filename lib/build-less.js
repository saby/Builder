'use strict';
const less = require('less'),
   path = require('path'),
   helpers = require('../lib/helpers'),
   LessError = require('less/lib/less/less-error'),
   autoprefixer = require('autoprefixer'),
   postcss = require('postcss'),
   postcssSafeParser = require('postcss-safe-parser'),
   postcssUrl = require('postcss-url'),
   pMap = require('p-map');

const invalidUrl = /^(\/|#|data:|[a-z]+:\/\/)(?=.*)/i;
const logger = require('./logger').logger();

const defaultTheme = 'online';

const oldThemes = [
   'carry',
   'carry_medium',
   'carrynew',
   'carrynew_medium',
   'cloud',
   'genie',
   'online',
   'presto',
   'presto_medium',
   'prestonew',
   'prestonew_medium'
];

const themesForModules = new Map([['CloudControl', 'cloud'], ['Presto', 'presto'], ['Retail', 'carry']]);


/**
 @workaround ресолвим текущую тему по названию модуля или папке в темах
 */
function resolveThemeName(filePath, modulePath) {
   const relativePath = filePath.replace(modulePath, '');
   for (const themeName of oldThemes) {
      if (relativePath.includes(`/themes/${themeName}/`)) {
         return themeName;
      }
   }
   const moduleName = path.basename(modulePath);
   if (themesForModules.has(moduleName)) {
      return themesForModules.get(moduleName);
   }
   return defaultTheme;
}

async function processLessFile(data, filePath, theme, gulpModulesInfo, appRootParams) {
   const { isMultiService, applicationRoot, resourcesUrl } = appRootParams;
   const { pathsForImport, gulpModulesPaths } = gulpModulesInfo;
   const imports = [];
   if (filePath.includes('/Controls/')) {
      logger.info(`Для lessки ${filePath} поставляется следующая конфигурация темы: ${JSON.stringify(theme, null, 3)}`);
   }
   const importLessName = oldThemes.includes(theme.name) ? '_variables' : theme.name;

   /**
    * импортим набор переменных в зависимости от темы и наличия
    * Controls-theme в проекте.
    * Для старых тем импортим _variables.less(непосредственно сам набор переменных),
    * для новых тем будем импортить непосредственно саму тему.
    */
   const controlsThemeIncluded = gulpModulesPaths.hasOwnProperty('Controls-theme');
   if (theme.path) {
      imports.push(`@import '${path.join(theme.path, importLessName)}';`);
   } else if (controlsThemeIncluded) {
      imports.push(`@import 'Controls-theme/themes/default/${importLessName}';`);
   }
   if (controlsThemeIncluded) {
      imports.push('@import \'Controls-theme/themes/default/helpers/_mixins\';');
   }
   imports.push(`@themeName: ${theme.name};`);
   const newData = [...imports, ...[data]].join('\n');
   try {
      const outputLess = await less.render(newData, {
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

      const processor = postcss([
         postcssUrl({
            url(asset) {
               // ignore absolute urls, hashes or data uris
               if (invalidUrl.test(asset.url)) {
                  return asset.url;
               }

               /**
                * Для онлайн-розницы пути до иконок разрешаются неправильно, поскольку:
                * 1) Собирается в рамках online-inside, который является мультисервисным, а для
                * мультисервисных приложений разрешать линки до абсолютных путей нельзя, поскольку
                * сервис определяется динамически Сервисом Представлений
                * 2) UI-модули проекта лежат на разных уровнях вложенности, поскольку берутся напрямую
                * из выкачанных репозиториев git'а, а платформа и вовсе из SDK.Для постоянного решения подобной проблемы
                * нужно перенастроить сборку, как вариант, все Интерфейсные модули линковать из гитовых исходников
                * в 1 обшую бабку InterfaceModules, и уже данные пути передавать сборщику. Например, раньше все темы
                * лежали в SBIS3.CONTROLS, иконки лежат в Controls-theme, оба этих модуля лежат в SDK на 1 уровне
                * вложенности, а значит и относительные пути до иконок будут разрешены правильно.
                */
               if (asset.url.includes('..') && asset.url.includes('/link_to_sdk/ui-modules/Controls-theme/')) {
                  let newFolder = 'Controls-theme';
                  if (applicationRoot && applicationRoot !== '/') {
                     newFolder = helpers.prettifyPath(path.join(applicationRoot, newFolder));
                  }
                  return asset.url.replace(/.*\/Controls-theme/, newFolder);
               }

               // из-за того, что less компилируются из исходников, а не из стенда,
               // в СБИС плаигне при импорте less из SBIS.CONTROLS получаются кривые пути
               // Для мультисервисных приложений урлы трогать нельзя.
               if (asset.url.includes('..') && !isMultiService) {
                  if (asset.url.includes('/SBIS3.CONTROLS/')) {
                     let newFolder = 'SBIS3.CONTROLS';
                     if (applicationRoot && applicationRoot !== '/') {
                        newFolder = helpers.prettifyPath(path.join(applicationRoot, newFolder));
                     }
                     if (!resourcesUrl) {
                        newFolder = `/${newFolder}`;
                     }
                     return asset.url.replace(/.*SBIS3\.CONTROLS/, newFolder);
                  }
                  if (asset.url.includes('/ui-modules/Controls/')) {
                     let newFolder = 'Controls';
                     if (applicationRoot && applicationRoot !== '/') {
                        newFolder = helpers.prettifyPath(path.join(applicationRoot, newFolder));
                     }
                     if (!resourcesUrl) {
                        newFolder = `/${newFolder}`;
                     }
                     return asset.url.replace(/.*\/ui-modules\/Controls/, newFolder);
                  }
                  if (asset.url.includes('/Controls-theme/')) {
                     let newFolder = 'Controls-theme';
                     if (applicationRoot && applicationRoot !== '/') {
                        newFolder = helpers.prettifyPath(path.join(applicationRoot, newFolder));
                     }
                     if (!resourcesUrl) {
                        newFolder = `/${newFolder}`;
                     }
                     return asset.url.replace(/.*\/Controls-theme/, newFolder);
                  }
               }
               return asset.url;
            }
         }),
         autoprefixer({ browsers: ['last 2 versions', 'ie>=10'], remove: false })
      ]);
      if (filePath.includes('themes')) {
         /**
          * надо поменять папку с путём до SDK, поскольку ")" является признаком конца урла в postcss-url,
          * а encodeURI не принесёт результата, поскольку ")" является валидной частью запроса и
          * не экранируется с помощью функций encodeURI и encodeURIComponent
          * TODO сделать более красиво, можно например засимлинкать модули из SDK в директорию без ")"
          */
         outputLess.css = outputLess.css.replace(/\/Program\\? Files\\? \\?\(x86\\?\)\//g, '/temp_form_sdk/');
      }
      const outputPostcss = await processor.process(
         outputLess.css,
         {
            parser: postcssSafeParser,
            from: filePath
         }
      );

      return {
         text: outputPostcss.css,
         imports: outputLess.imports,
         nameTheme: theme.name,
         defaultTheme: theme.isDefault,
         importedByBuilder: imports
      };
   } catch (error) {
      if (error instanceof LessError) {
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
            errorLineStr = ` на строке ${errorLine.toString()}`;
         }

         // error.filename может быть где-то в импортируемых лесс файлах. поэтому дублирования информации нет
         const message = `Ошибка компиляции ${error.filename} для темы ${theme.name}: ${errorLineStr}: ${error.message}`;
         throw new Error(message);
      }
      throw error;
   }
}

async function buildLess(
   lessInfo,
   gulpModulesInfo,
   notThemedLess,
   styleThemes,
   appRootParams
) {
   const { filePath, text, modulePath } = lessInfo;
   const prettyRelativeFilePath = helpers.prettifyPath(path.relative(modulePath, filePath));
   const partsOfRelativeFilePath = prettyRelativeFilePath.split('/');
   if (path.basename(filePath).startsWith('_') || partsOfRelativeFilePath.includes('_less')) {
      return [{
         ignoreMessage: `Файл '${filePath}' не будет компилироваться.`
      }];
   }

   const prettyFilePath = helpers.prettifyPath(filePath);

   const prettyModulePath = helpers.prettifyPath(modulePath);
   const defaultModuleTheme = resolveThemeName(prettyFilePath, prettyModulePath);

   /**
    * Темы билдим без тем. Также в качестве исключения добавляем SBIS3.CONTROLS/default-theme, поскольку здесь хранится
    * дефолтная тема проекта.
    * @type {*|boolean}
    */
   const isThemePath = prettyRelativeFilePath.startsWith('themes/') || prettyFilePath.includes('SBIS3.CONTROLS/default-theme/');

   const buildAllThemes = [];
   const results = [];
   const defaultModuleThemeObject = {
      name: defaultModuleTheme,
      isDefault: true
   };
   if (styleThemes.hasOwnProperty(defaultModuleTheme)) {
      defaultModuleThemeObject.path = styleThemes[defaultModuleTheme];
   }
   buildAllThemes.push(
      processLessFile(
         text,
         prettyFilePath,
         defaultModuleThemeObject,
         gulpModulesInfo,
         appRootParams || {}
      )
   );

   /**
    * less'ки непосредственно в папке ${UI-module}/themes нужно компилить исключительно без тем
    */
   if (!notThemedLess && !isThemePath && lessInfo.themes) {
      for (const themeName of Object.keys(styleThemes)) {
         /**
          * default тему можно билдить исключительно с WS4, то есть только с модулем "Controls"
          * @type {boolean}
          */
         const oldModuleNewDefaultTheme = themeName === 'default' && path.basename(modulePath) !== 'Controls';
         if (!oldModuleNewDefaultTheme) {
            buildAllThemes.push(processLessFile(text, prettyFilePath, {
               name: themeName,
               path: styleThemes[themeName]
            }, gulpModulesInfo, appRootParams || {}));
         }
      }
   }

   /**
    * билдим все темы, но если одна зафейлилась, то остальные мы автоматически
    * не грохаем. Будем возвращать для каждой скомпиленной lessки объект. В зависимости
    * от результата она будет содержать свойство
    * error - сообщение о произошедшей ошибке.
    * compiled - результаты успешной компиляции less.
    */
   await pMap(
      Object.keys(buildAllThemes),
      async(key) => {
         try {
            const currentResult = await buildAllThemes[key];
            results.push({
               compiled: currentResult
            });
         } catch (error) {
            results.push({
               error: error.message,
               key: Number(key)
            });
         }
      }
   );
   return results;
}

module.exports = buildLess;
