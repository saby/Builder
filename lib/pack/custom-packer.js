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
   transliterate = require('../../lib/transliterate');

async function rebaseCSS(css, appRoot, urlServicePath) {
   if (await fs.pathExists(css)) {
      const content = await fs.readFile(css);
      const resourceRoot = `${path.join(urlServicePath, 'resources/')}`;
      return cssHelpers.rebaseUrls(appRoot, css, content.toString(), resourceRoot);
   }
   logger.info(`ENOENT: no such css style to pack: ${css}`);
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

function getCompiledLessByCssName(compiledLess, cssName) {
   return compiledLess
      .filter(currentCss => currentCss === (`${cssName}.min.css`) || currentCss.startsWith(`${cssName}_`))
      .map(currentCss => currentCss.replace(/(\.min)?\.css$/, ''));
}

/**
 * Разбивает набор cssок по темам в соответствии с постфиксом _{themeName}
 * @param{Array} cssModules - набор css
 * @returns{Object} themeName: listOfCss
 */
function splitCssByThemes(
   cssModules,
   themesList,
   compiledLess,
   applicationRoot,
   moduleName
) {
   const result = {};
   cssModules.forEach((module) => {
      const
         cssFullPath = module.moduleYes ? module.moduleYes.fullPath : module.fullPath,
         cssName = helpers.removeLeadingSlash(
            cssFullPath.replace(applicationRoot, '').replace(/(\.min)?\.css$/, '')
         );

      // If we analize css from another Interface Module, we need to search it in joined "compiled less meta"
      let compiledLessForCurrentCss;
      if (cssName.startsWith(`${moduleName}/`)) {
         compiledLessForCurrentCss = getCompiledLessByCssName(
            compiledLess[moduleName] || [],
            cssName
         );
      } else {
         compiledLessForCurrentCss = getCompiledLessByCssName(
            compiledLess.all || [],
            cssName
         );
      }

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

function checkConfigForIncludeOption(config) {
   return config.includeCore || (config.include && config.include.length > 0);
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
   if (!checkConfigForIncludeOption(packageConfig)) {
      throw new Error('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   }

   orderQueue = packHelpers.getOrderQueue(depsTree, packageConfig, excludedCSS, applicationRoot).filter((node) => {
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
            taskParameters.compiledLessByModules,
            helpers.unixifyPath(applicationRoot),
            moduleName
         );

      let applicationForRebase = '/';

      /**
       * We should ignore BL services("/service/"). app root can be selected only for project's
       * UI services.
       */
      if (
         taskParameters.config.urlServicePath &&
         !taskParameters.config.urlServicePath.includes('/service')
      ) {
         applicationForRebase = taskParameters.config.urlServicePath;
      }
      const cssExternalModuleUsageMessages = new Set();

      await pMap(
         Object.keys(splittedCssByThemes),
         async(themeName) => {
            const cssRes = await customPackCSS(
               splittedCssByThemes[themeName]
                  .map(function onlyPath(cssName) {
                     const currentCssPath = helpers.unixifyPath(path.join(applicationRoot, `${cssName}.min.css`));
                     const cssIsPackageOutput = currentCssPath === outputFile.replace(/\.js$/, '.css');

                     const currentFileModuleName = cssName.split('/').shift();

                     /**
                      * Temporarily ignore external dependencies of Employee custom packages. It has
                      * many Interface modules dependencies, that not existing in billing project
                      * TODO delete it after the completion of the projects. For detailed info see
                      * https://online.sbis.ru/opendoc.html?guid=79bd3d07-fc44-4318-a28d-d39b50483bed
                      * Temporarily ignore external dependencies of CoreUserCalendar custom packages.
                      * TODO delete after error fix https://online.sbis.ru/doc/bd8e6980-8bcc-4079-b1fd-9c96d7a0dbd3
                      */
                     if (
                        moduleName !== 'Employee' &&
                        moduleName !== 'CoreUserCalendar' &&
                        currentFileModuleName !== moduleName &&
                        packageConfig.moduleInfo &&
                        !packageConfig.moduleInfo.depends.includes(currentFileModuleName)
                     ) {
                        const message = `External interface module "${currentFileModuleName}" usage in custom package(styles).` +
                           'Check for it existance in current interface module dependencies';
                        cssExternalModuleUsageMessages.add(message);
                     }

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
                        const removeMessage = `Style ${currentCssPath} was removed in namespace of Interface module ${packageConfig.moduleName}.` +
                        `Packed into ${packageConfig.output}`;
                        logger.debug(removeMessage);
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
               applicationForRebase
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

            const cssPackagePath = packHelpers.getCssPackagePathForMeta(themeName, packagePath);
            taskParameters.versionedModules[moduleName].push(cssPackagePath);
            taskParameters.cdnModules[moduleName].push(cssPackagePath);
         },
         {
            concurrency: 10
         }
      );
      cssExternalModuleUsageMessages.forEach(message => logger.error({
         message,
         filePath: packageConfig.path,
         moduleInfo: packageConfig.moduleInfo
      }));
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

   /**
    * write libraries meta into bundlesRoute.json.
    * Libraries should be ignored from runtime packing
    */
   await pMap(
      Object.keys(taskParameters.librariesMeta),
      async(currentModule) => {
         const currentBundlesRoutePath = path.join(applicationRoot, currentModule, 'bundlesRoute.json');
         let currentBundlesRoute = {};
         if (await fs.pathExists(currentBundlesRoutePath)) {
            currentBundlesRoute = await fs.readJson(currentBundlesRoutePath);
         }
         taskParameters.librariesMeta[currentModule].forEach((currentLibrary) => {
            // dont write libraries into bundlesRoute meta if packed into custom package
            if (!result.bundlesRoute[currentLibrary]) {
               const normalizedLibraryPath = `${taskParameters.config.resourcesUrl ? 'resources/' : '/'}${currentLibrary}.min.js`;
               currentBundlesRoute[currentLibrary] = normalizedLibraryPath;
            }
         });
         await fs.outputJson(currentBundlesRoutePath, currentBundlesRoute);
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
   taskParameters.compiledLessByModules = {
      all: []
   };
   if (taskParameters.config.modules instanceof Array) {
      await pMap(
         taskParameters.config.modules,
         async(moduleInfo) => {
            const moduleName = transliterate(moduleInfo.name);
            const metaPath = path.join(root, moduleName, '.builder/compiled-less.min.json');
            if (await fs.pathExists(metaPath)) {
               const currentLessMeta = await fs.readJson(metaPath);
               taskParameters.compiledLessByModules[moduleName] = currentLessMeta;
               taskParameters.compiledLessByModules.all.push(...currentLessMeta);
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

/**
 * Получаем набор путь до бандла - конфигурация пакета
 * по пути, прописанном в супербандле
 * @param bundlePath - путь до бандла в конфигурации супербандла
 * @param configs - набор конфигураций кастомной паковки
 * @returns {*}
 */
function getCommonBundleByPath(bundlePath, configs) {
   let result = [null, null];
   Object.entries(configs).forEach((currentEntry) => {
      if (currentEntry[0].includes(bundlePath)) {
         result = currentEntry;
      }
   });
   return result;
}

function filterBadExcludeRules(config) {
   return config.exclude.filter((currentExcludeRule) => {
      let
         maskType = '',
         keepExcludeRule = true,
         currentExcludeNamespace;

      if (currentExcludeRule.includes('*')) {
         currentExcludeNamespace = currentExcludeRule
            .slice(0, currentExcludeRule.indexOf('*'));
         maskType = 'pattern';
      } else {
         currentExcludeNamespace = currentExcludeRule;
         maskType = 'singleton';
      }

      config.include.forEach((currentIncludeRule) => {
         if (!keepExcludeRule) {
            return;
         }
         if (
            maskType === 'pattern' &&
            currentIncludeRule.startsWith(currentExcludeNamespace) &&
            currentIncludeRule.length > currentExcludeNamespace.length
         ) {
            logger.info(`Для супербандла ${config.output} удалено правило exclude "${currentExcludeRule}".` +
               `Поскольку в include присутствует правило с большей вложенностью: ${currentIncludeRule}`);
            keepExcludeRule = false;
         }
         if (maskType === 'singleton' && currentIncludeRule === currentExcludeNamespace) {
            logger.info(`Для супербандла ${config.output} удалено правило exclude "${currentExcludeRule}".` +
               'Поскольку в include присутствует точно такое же правило');
            keepExcludeRule = false;
         }
      });

      return keepExcludeRule;
   });
}

/**
 * Задаёт modules, include и exclude для супербандла,
 * включая в него все пакеты, переданные в конфигурации супербандла.
 * Удаляет из обработки все пакеты, попавшие в супербандл.
 * @param configs - полный набор конфигураций кастомных пакетов
 */
async function setSuperBundle(root, configs) {
   const { commonBundles, superBundles } = configs;
   await pMap(
      superBundles,
      async(currentSuperBundle) => {
         // set default options for superbundle: "includeCore", "platformPackage"
         currentSuperBundle.includeCore = true;
         currentSuperBundle.platformPackage = true;
         if (!currentSuperBundle.include) {
            currentSuperBundle.include = [];
         }
         if (!currentSuperBundle.exclude) {
            currentSuperBundle.exclude = [];
         }
         currentSuperBundle.packagesRules = {};
         currentSuperBundle.includePackages.forEach((currentPackagePath) => {
            const [fullPackageName, neededPackage] = getCommonBundleByPath(currentPackagePath, commonBundles);
            if (neededPackage) {
               currentSuperBundle.packagesRules[fullPackageName] = {};
               if (neededPackage.include && neededPackage.include.length > 0) {
                  currentSuperBundle.include.splice(currentSuperBundle.include.length, 0, ...neededPackage.include);
                  currentSuperBundle.packagesRules[fullPackageName].include = neededPackage.include;
               }
               if (neededPackage.exclude && neededPackage.exclude.length > 0) {
                  currentSuperBundle.exclude.splice(currentSuperBundle.exclude.length, 0, ...neededPackage.exclude);
                  currentSuperBundle.packagesRules[fullPackageName].exclude = neededPackage.exclude;
               }
               delete commonBundles[fullPackageName];
            }
         });
         if (currentSuperBundle.includeCore && !currentSuperBundle.modules) {
            currentSuperBundle.modules = currentSuperBundle.include;
         }
         currentSuperBundle.exclude = filterBadExcludeRules(currentSuperBundle);

         /**
          * Сохраним конфигурацию для пакета, чтобы впоследствии мы могли посмотреть на конечную
          * конфигурацию супербандла для паковки со всеми правилами.
          */
         await fs.outputJson(
            path.join(
               root,
               path.dirname(currentSuperBundle.path),
               `.builder/${currentSuperBundle.output}.package.json`
            ),
            currentSuperBundle
         );
      },
      {
         concurrency: 50
      }
   );
}

module.exports = {
   generateAllCustomPackages,
   saveModuleCustomPackResults,
   saveRootBundlesMeta,
   generateCustomPackage,
   rebaseCSS,
   collectAllIntersects,
   filterBadExcludeRules,
   setSuperBundle
};
