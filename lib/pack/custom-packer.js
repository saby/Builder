'use strict';

const commonPackage = require('../../packer/lib/common-package'),
   fs = require('fs-extra'),
   logger = require('../../lib/logger').logger(),
   packerDictionary = require('../../packer/tasks/lib/pack-dictionary'),
   packHelpers = require('./helpers/custompack'),
   path = require('path'),
   pMap = require('p-map'),
   helpers = require('../../lib/helpers'),
   cssHelpers = require('../../packer/lib/css-helpers'),
   builderConstants = require('../../lib/builder-constants'),
   modulePathToRequire = require('../modulepath-to-require'),
   transliterate = require('../../lib/transliterate');

async function rebaseCSS(css, appRoot, urlServicePath) {
   if (await fs.pathExists(css)) {
      const content = await fs.readFile(css);
      const resourceRoot = `${path.join(urlServicePath, 'resources/')}`;
      return cssHelpers.rebaseUrls(appRoot, css, content.toString(), resourceRoot);
   }
   logger.info(`ENOENT: no such css style: ${css}`);
   return '';
}

async function customPackCSS(files, root, application) {
   const results = await pMap(
      files,
      async(css) => {
         const result = await rebaseCSS(css, root, application);
         return result;
      },
      {
         concurrency: 10
      }
   );

   return cssHelpers.bumpImportsUp(results.join('\n'));
}

async function writeCustomPackage(
   packageConfig,
   root,
   application,
   taskParameters
) {
   const
      currentFileExists = await fs.pathExists(packageConfig.outputFile),
      originalFileExists = await fs.pathExists(packHelpers.originalPath(packageConfig.outputFile));

   // Не будем портить оригинальный файл.
   if (currentFileExists && !originalFileExists) {
      await fs.copy(packageConfig.outputFile, packHelpers.originalPath(packageConfig.outputFile));
   }

   const modulesContent = await commonPackage.limitingNativePackFiles(
      packageConfig,
      root,
      application,
      taskParameters
   );

   /**
    * Отсортируем контент модулей по именам модулей,
    * чтобы между двумя дистрами не было разницы в случае
    * одинакового набора модулей пакета.
    * @type {string[]}
    */
   const listOfModules = Object.keys(modulesContent).sort();
   const result = [];
   if (listOfModules.length > 0) {
      listOfModules.forEach((currentModule) => {
         result.push(modulesContent[currentModule]);
      });
   }
   if (packageConfig.cssModulesFromOrderQueue.length > 0) {
      result.unshift(
         packHelpers.generateLinkForCss(packageConfig.cssModulesFromOrderQueue, packageConfig.packagePath)
      );
   } else if (listOfModules.length === 0) {
      /**
       * если в качестве результата нам вернулась пустая строка и при этом
       * полностью отсутствуют стили на запись в кастомный пакет, значит,
       * скорее всего, создатели неправильно описали правила паковки
       */
      throw new Error('В ваш пакет ничего не запаковалось, проверьте правильность описания правил паковки в package.json файле');
   }

   /**
    * теперь на использование флага optimized будем ругаться предупреждениями, поскольку
    * в рамках перехода на библиотеки данный флаг не нужен
    */
   if (packageConfig.optimized) {
      logger.warning({
         message: 'Использование неразрешённой опции optimized в конфигурации кастомной паковки. ' +
            'Пакет будет сохранён по стандартной схеме',
         filePath: packageConfig.path
      });
   }
   await fs.outputFile(
      packageConfig.outputFile,
      result ? result.reduce((res, modContent) => res + (res ? '\n' : '') + modContent) : ''
   );
}

/**
 * Разбивает набор cssок по темам в соответствии с постфиксом _{themeName}
 * @param{Array} cssModules - набор css
 * @returns{Object} themeName: listOfCss
 */
function splitCssByThemes(cssModules, themesList, compiledLess, moduleName) {
   const result = {};
   cssModules.forEach((module) => {
      const
         cssNodeName = module.moduleYes ? module.moduleYes.fullName : module.fullName,
         cssName = cssNodeName.replace(/.*css!(theme\?)?/, '');

      const compiledLessForCurrentCss = compiledLess
         .filter((currentCss) => {
            let normalizedCss;
            if (moduleName === 'WS.Core' || moduleName === 'WS.Deprecated') {
               normalizedCss = modulePathToRequire.getPrettyPath(currentCss);
            } else {
               normalizedCss = currentCss;
            }
            return normalizedCss === (`${cssName}.min.css`) ||
               normalizedCss.startsWith(`${cssName}_`);
         })
         .map(currentCss => currentCss.replace(/\.min\.css$/, ''));

      if (compiledLessForCurrentCss.length > 0) {
         compiledLessForCurrentCss.forEach((currentCss) => {
            let themeName = '';
            const currentCssThemeParts = path.basename(currentCss).split('_');
            if (currentCssThemeParts.length > 1) {
               themeName = currentCssThemeParts.pop();
            }
            if (!themeName || themesList.includes(themeName)) {
               if (!result.hasOwnProperty(themeName)) {
                  result[themeName] = [currentCss];
               } else {
                  result[themeName].push(currentCss);
               }
            }
         });

      /**
       * если не нашли информации о css в мета-файле скомпилированных less,
       * значит мы имеем дело со статическими css, их упаковываем по дефолтной схеме.
       * Для статических css будут игнорироваться постфиксы, кто хочет использовать темизацию,
       * пусть переходят на less.
       */
      } else if (!result.hasOwnProperty('')) {
         result[''] = [cssName];
      } else {
         result[''].push(cssName);
      }
   });
   return result;
}

async function generateCustomPackage(
   depsTree,
   root,
   application,
   packageConfig,
   taskParameters
) {
   const
      availableLanguage = taskParameters.config.localizations,
      applicationRoot = path.join(root, application),
      outputFile = packHelpers.getOutputFile(packageConfig, applicationRoot, depsTree),
      packagePath = packHelpers.getBundlePath(outputFile, applicationRoot),
      pathToCustomCSS = outputFile.replace(/(\.package)?(\.min)?\.js$/, ''),
      cssExtIncludesPackage = outputFile.replace(/(\.min)?\.js$/, '').endsWith('.package'),
      { resourcesUrl } = taskParameters.config,
      result = {
         bundles: {},
         bundlesRoute: {},
         excludedCSS: {}
      },
      excludedCSS = {};

   let
      cssModulesFromOrderQueue = [],
      bundlePath = helpers.removeLeadingSlash(packagePath),
      orderQueue;

   if (resourcesUrl) {
      bundlePath = `resources/${bundlePath}`;
   }
   if (packageConfig.isBadConfig) {
      throw new Error('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   }

   orderQueue = packHelpers.getOrderQueue(depsTree, packageConfig, excludedCSS, applicationRoot).filter((node) => {
      /**
       * Для обычных пакетов произведём фильтрацию тех модулей, что уже
       * записаны в приоритетных пакетах
       */
      if (node.plugin === 'js' || node.plugin === 'tmpl' || node.plugin === 'html') {
         return node.amd;
      }
      if (node.fullName.includes('css!')) {
         cssModulesFromOrderQueue.push(node);
         return false;
      }
      return true;
   });

   /**
    * создадим мета-данные для модуля, если этого не было сделано в рамках
    * Инкрементальной сборки. Нужно включать все безусловно, в пакетах могут
    * быть запакованы шаблоны с версионированием.
    */
   const moduleName = packagePath.split('/')[0];
   if (!taskParameters.versionedModules[moduleName]) {
      taskParameters.versionedModules[moduleName] = [];
   }
   if (!taskParameters.cdnModules[moduleName]) {
      taskParameters.cdnModules[moduleName] = [];
   }
   taskParameters.versionedModules[moduleName].push(`${packagePath}.js`);
   taskParameters.cdnModules[moduleName].push(`${packagePath}.js`);
   packageConfig.moduleName = moduleName;
   packageConfig.moduleOutput = helpers.prettifyPath(path.join(applicationRoot, moduleName));

   /**
    * пишем все стили по пути кастомного пакета в css-файл.
    */
   cssModulesFromOrderQueue = commonPackage.prepareResultQueue(
      cssModulesFromOrderQueue,
      applicationRoot,
      availableLanguage
   );
   if (cssModulesFromOrderQueue.css.length > 0) {
      const
         projectThemes = (taskParameters.cache && Object.keys(taskParameters.cache.currentStore.styleThemes)) || [],
         splittedCssByThemes = splitCssByThemes(
            cssModulesFromOrderQueue.css,
            projectThemes,
            taskParameters.compiledLessByModules[moduleName] || [],
            moduleName
         );

      await pMap(
         Object.keys(splittedCssByThemes),
         async(themeName) => {
            const cssRes = await customPackCSS(
               splittedCssByThemes[themeName]
                  .map(function onlyPath(cssName) {
                     const currentCssPath = helpers.unixifyPath(path.join(applicationRoot, `${cssName}.min.css`));
                     const cssIsPackageOutput = currentCssPath === outputFile.replace(/\.js$/, '.css');

                     /**
                      * 1)Мы не должны удалять модуль, если в него будет записан результат паковки.
                      * 2)Все стили должны удаляться только в рамках Интерфейсного модуля,
                      * в котором строится кастомный пакет.
                      * 3)Не стоит удалять темизированные стили, пока не будет реализован функционал
                      * со стороны VDOM, обеспечивающий загрузку кастомных темизированных css-пакетов
                      * через require.
                      */
                     if (
                        !taskParameters.config.sources &&
                        !cssIsPackageOutput &&
                        currentCssPath.startsWith(packageConfig.moduleOutput) &&
                        !themeName
                     ) {
                        taskParameters.filesToRemove.push(currentCssPath);
                        logger.debug(`Удалили стиль ${currentCssPath} в рамках Интерфейсного модуля ${packageConfig.moduleName}`);
                        helpers.removeFileFromBuilderMeta(
                           taskParameters.versionedModules[moduleName],
                           currentCssPath
                        );
                        helpers.removeFileFromBuilderMeta(
                           taskParameters.cdnModules[moduleName],
                           currentCssPath
                        );
                     }
                     return currentCssPath;
                  }),
               root,
               application
            );
            await fs.outputFile(
               `${pathToCustomCSS}${themeName ? `_${themeName}` : ''}` +
               `${cssExtIncludesPackage ? '.package' : ''}.min.css`,
               cssRes
            );

            /**
             * создадим мета-данные для модуля, если этого не было сделано в рамках
             * Инкрементальной сборки
             */
            if (!taskParameters.versionedModules[moduleName]) {
               taskParameters.versionedModules[moduleName] = [];
            }
            if (!taskParameters.cdnModules[moduleName]) {
               taskParameters.cdnModules[moduleName] = [];
            }
            taskParameters.versionedModules[moduleName].push(`${packagePath}.css`);
            taskParameters.cdnModules[moduleName].push(`${packagePath}.css`);
         },
         {
            concurrency: 10
         }
      );
   }

   /**
    * Чистим всю локализацию до формирования bundles и bundlesRoute
    * @type {Array}
    */
   orderQueue = packerDictionary.deleteModulesLocalization(orderQueue);
   if (packageConfig.platformPackage || !packageConfig.includeCore) {
      const cssBundlePath = pathToCustomCSS.replace(helpers.unixifyPath(applicationRoot), '');
      result.bundles[bundlePath] = (await packHelpers.generateBundle(
         orderQueue,
         cssModulesFromOrderQueue.css
      )).sort();
      result.bundlesRoute = packHelpers.generateBundlesRouting(
         result.bundles[bundlePath],
         bundlePath,
         {
            cssExtIncludesPackage,
            cssBundlePath,
            excludedCSS,
            resourcesUrl
         }
      );
   }

   packageConfig.orderQueue = await packerDictionary.packerCustomDictionary(
      orderQueue,
      applicationRoot,
      depsTree,
      availableLanguage
   );
   packageConfig.outputFile = outputFile;
   packageConfig.packagePath = packagePath;
   packageConfig.cssModulesFromOrderQueue = cssModulesFromOrderQueue.css;
   result.output = packageConfig.outputFile;

   result.excludedCSS = excludedCSS;
   await writeCustomPackage(
      packageConfig,
      root,
      application,
      taskParameters
   );
   return result;
}

/**
 * Сортируем объект по его ключам
 * @param currentObject
 */
function sortObjectByKeys(currentObject) {
   const result = {};
   Object.keys(currentObject).sort().forEach((currentProperty) => {
      result[currentProperty] = currentObject[currentProperty];
   });
   return result;
}

/**
 * Сохраняем общие результаты паковки(bundles и bundlesRoute) в корень приложения
 * @returns {Promise<void>}
 */
async function saveRootBundlesMeta(root, result) {
   // паковка вызывается только в релизе, поэтому сохраняем .min
   await fs.writeFile(
      path.join(root, 'bundles.min.js'),
      `bundles=${JSON.stringify(result.bundles)}`
   );
   await fs.writeJson(
      path.join(root, 'bundles.json'),
      result.bundles
   );
   await fs.writeJson(
      path.join(root, 'bundlesRoute.json'),
      result.bundles
   );
}

/**
 * Функция, которая сплитит результат работы таски custompack в секции bundles
 */
async function saveBundlesForEachModule(taskParameters, applicationRoot, result) {
   /**
    * Сделаем список json на запись, нам надо защититься от параллельной перезаписи
    */
   const jsonToWrite = {};
   await pMap(
      Object.keys(result.bundles),
      async(currentBundle) => {
         const intModuleName = currentBundle.match(/(^resources\/)?([^/]+)/)[2],
            currentModules = result.bundles[currentBundle];

         const
            bundlesRoutePath = path.normalize(path.join(applicationRoot, intModuleName, 'bundlesRoute.json')),
            bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, 'bundles.json'));

         if (taskParameters.config.sources && (await fs.pathExists(bundlesRoutePath))) {
            jsonToWrite[bundlesRoutePath] = await fs.readJson(bundlesRoutePath);
         }

         if (await fs.pathExists(bundlesPath)) {
            jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
         }

         if (taskParameters.config.sources && !jsonToWrite[bundlesRoutePath]) {
            jsonToWrite[bundlesRoutePath] = {};
         }

         if (!jsonToWrite[bundlesPath]) {
            jsonToWrite[bundlesPath] = {};
         }

         currentModules.forEach((node) => {
            /**
             * Все css-модули, которые были выкинуты из кастомных пакетов путём использования
             * опции exclude, не должны попадать в bundlesRoute, поскольку:
             * 1) При наличии одинаковых имён со своими компонентами css всё равно попадут в bundles,
             * но запишутся в js-пакет.
             * 2) Из 1го следует что такие cssки должны быть описаны в bundles(чтобы require не ошибался
             * и ходил за cssкой в jsный пакет, а не в cssный), но не должны быть описаны в bundlesRoute
             * (чтобы Сервис Представлений не вставлял cssный пакет и не обьявлял css как пустышку без
             * наличия стиля как такового
             */
            if (taskParameters.config.sources && !result.excludedCSS.hasOwnProperty(node)) {
               jsonToWrite[bundlesRoutePath][node] = result.bundlesRoute[node];
            }
         });
         jsonToWrite[bundlesPath][currentBundle] = result.bundles[currentBundle];
      },
      {
         concurrency: 10
      }
   );
   await pMap(Object.keys(jsonToWrite), key => fs.outputJson(key, sortObjectByKeys(jsonToWrite[key])), {
      concurrency: 10
   });
}

/**
 * Сохраняем результаты работы кастомной паковки для всех секций.
 */
async function saveModuleCustomPackResults(taskParameters, result, applicationRoot) {
   await saveBundlesForEachModule(taskParameters, applicationRoot, result);

   /**
    * Сохраним помодульные мета-файлы билдера versioned_modules.json
    */
   if (taskParameters.config.version) {
      await pMap(
         Object.keys(taskParameters.versionedModules),
         async(currentModule) => {
            await fs.outputJson(
               path.join(applicationRoot, currentModule, '.builder/versioned_modules.json'),
               taskParameters.versionedModules[currentModule].sort()
            );
         },
         {
            concurrency: 10
         }
      );
   }

   /**
    * Сохраним помодульные мета-файлы билдера cdn_modules.json
    */
   await pMap(
      Object.keys(taskParameters.cdnModules),
      async(currentModule) => {
         await fs.outputJson(
            path.join(applicationRoot, currentModule, '.builder/cdn_modules.json'),
            taskParameters.cdnModules[currentModule].sort()
         );
      },
      {
         concurrency: 10
      }
   );
}

/**
 * Создаёт кастомный пакет по текущей конфигурации. Записывает результаты компиляции
 * ( bundles и bundlesRoute) в общий набор - results
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {DependencyGraph} depsTree граф зависимостей
 * @param {Object} currentConfig текущая конфигурация кастомной паковки
 * @param {Object}results общие результаты компиляции для всех кастомных пакетов
 * @param {String} root корень приложения
 * @returns {Promise<void>}
 */
async function compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root) {
   let currentResult = {
      bundles: {},
      bundlesRoute: {},
      excludedCSS: {}
   };


   const configNum = currentConfig.configNum ? `конфигурация №${currentConfig.configNum}` : '';
   try {
      /**
       * результатом выполнения функции мы сделаем объект, он будет содержать ряд опций:
       * 1)bundles: в нём будут храниться подвергнутые изменениям бандлы.
       * 2)bundlesRoute: тоже самое что и выше, только для bundlesRoute.
       */
      currentResult = await generateCustomPackage(
         depsTree,
         root,

         // application
         '/',
         currentConfig,
         taskParameters
      );
      packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'excludedCSS');
      logger.debug(`Создан кастомный пакет по конфигурационному файлу ${currentConfig.packageName} - ${configNum}- ${currentConfig.output}`);
   } catch (err) {
      logger.error({
         message: `Ошибка создания кастомного пакета по конфигурационному файлу ${
            currentConfig.packageName} - ${configNum}- ${currentConfig.output}`,
         error: err,
         filePath: currentConfig.path
      });
   }
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundlesRoute');
}

/**
 * Генерирует кастомные пакеты для всего набора конфигураций кастомной паковки.
 * Сперва приоритетные, для них создаётся набор записанных модулей. Затем обычные
 * пакеты, в которые уже не смогут попасть модули из приоритетных пакетов.
 * @param {Object} configs общий набор конфигураций кастомной паковки
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {Object} depsTree граф зависимостей
 * @param {Object} results общие результаты компиляции для всех кастомных пакетов
 * @param {String} root корень приложения
 * @returns {Promise<void>}
 */
async function generateAllCustomPackages(configs, taskParameters, depsTree, results, root) {
   const configsArray = [...Object.keys(configs.commonBundles).map(key => configs.commonBundles[key])];
   if (configs.superBundles && configs.superBundles.length > 0) {
      configsArray.splice(configsArray.length, 0, ...configs.superBundles);
   }
   taskParameters.compiledLessByModules = {};
   if (taskParameters.config.modules instanceof Array) {
      await pMap(
         taskParameters.config.modules,
         async(moduleInfo) => {
            const moduleName = transliterate(moduleInfo.name);
            const metaPath = path.join(root, moduleName, '.builder/compiled-less.min.json');
            if (await fs.pathExists(metaPath)) {
               taskParameters.compiledLessByModules[moduleName] = await fs.readJson(metaPath);
            }
         },
         {
            concurrency: 20
         }
      );
   }
   await pMap(
      configsArray,
      async(currentConfig) => {
         await compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root);
      },
      {
         concurrency: 10
      }
   );
}

/**
 * Возвращаем название Интерфейсного модуля
 * @param {String} nodeName - полное имя модуля
 * @returns {*} Название Интерфейсного модуля
 */
function getUiModuleName(nodeName) {
   const firstModulePart = nodeName.split('/')[0];
   if (firstModulePart.includes('!')) {
      return firstModulePart.split('!').pop();
   }
   return firstModulePart;
}

/**
 * Разбиваем пересечения по Интерфейсным модулям
 * @param {String} root корень приложения
 * @param {Array[][]} intersects пересечения между кастомными пакетами
 * @returns {Promise<void>}
 */
async function splitIntersectsByUiModuleName(root, intersects) {
   const intersectsByUiModules = {};

   intersects.forEach((currentEntry) => {
      const
         currentModule = currentEntry[0],
         currentModuleIntersect = currentEntry[1].sort(),
         interfaceModule = getUiModuleName(currentModule);

      let currentUiIntersect = intersectsByUiModules[interfaceModule];
      if (!currentUiIntersect) {
         currentUiIntersect = {};
         currentUiIntersect[currentModule] = currentModuleIntersect;
         intersectsByUiModules[interfaceModule] = currentUiIntersect;
      } else {
         currentUiIntersect[currentModule] = currentModuleIntersect;
      }
   });

   await pMap(
      Object.entries(intersectsByUiModules),
      async(currentEntry) => {
         const
            currentUiModuleName = currentEntry[0],
            currentUiModuleIntersects = currentEntry[1],
            intersectOutput = path.join(root, `${currentUiModuleName}${builderConstants.metaFolder}customPackIntersects.json`);
         logger.info(
            `В Интерфейсном модуле ${currentUiModuleName} присутствуют пересечения между кастомными пакетами!` +
            ` Посмотреть можно в json-файле по пути ${intersectOutput}`
         );
         await fs.outputJson(intersectOutput, sortObjectByKeys(currentUiModuleIntersects));
      },
      {
         concurrency: 10
      }
   );
}

/**
 * Собираем в один файл все пересечения между кастомными пакетами.
 * @param {String} root - корень приложения
 * @param {Object} results - результаты создания кастомных пакетов
 * @returns {Promise<void>}
 */
async function collectAllIntersects(root, results) {
   const
      { bundles } = results,
      allBundlesRoute = {};

   Object.entries(bundles).forEach((currentEntry) => {
      const
         currentBundleName = currentEntry[0],
         currentBundle = currentEntry[1];

      currentBundle.forEach((module) => {
         if (!allBundlesRoute.hasOwnProperty(module)) {
            allBundlesRoute[module] = [currentBundleName];
         } else {
            allBundlesRoute[module].push(currentBundleName);
         }
      });
   });

   await splitIntersectsByUiModuleName(
      root,

      /**
       * оставляем только те модули, у которых больше 1 вхождения в кастомные пакеты
       */
      Object.entries(allBundlesRoute).filter(currentEntry => currentEntry[1].length > 1)
   );
}

module.exports = {
   generateAllCustomPackages,
   saveModuleCustomPackResults,
   saveRootBundlesMeta,
   generateCustomPackage,
   rebaseCSS,
   collectAllIntersects
};
