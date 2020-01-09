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
   transliterate = require('../../lib/transliterate'),
   { normalizeModuleName } = require('../modulepath-to-require');

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
   const listOfModules = helpers.descendingSort(Object.keys(modulesContent));
   const result = [];
   if (listOfModules.length > 0) {
      listOfModules.forEach((currentModule) => {
         result.push(modulesContent[currentModule]);
      });
   }
   if (packageConfig.cssModulesFromOrderQueue.length > 0) {
      let cssPackagePath;

      /**
       * result of extendable bundle will be joined into root superbundle.
       * We need to set root Interface module(for now its WS.Core)
       * for dependency of css joined superbundle
       */
      if (packageConfig.extendsTo) {
         cssPackagePath = `WS.Core/${packageConfig.extendsTo.replace(/\.js$/, '')}`;
      } else {
         cssPackagePath = packageConfig.packagePath;
      }
      result.unshift(
         packHelpers.generateLinkForCss(packageConfig.cssModulesFromOrderQueue, cssPackagePath)
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
         cssName = helpers.removeLeadingSlashes(
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
      rootForCache = taskParameters.config.cachePath ? `${taskParameters.config.cachePath}/incremental_build` : applicationRoot,
      { resourcesUrl } = taskParameters.config,
      result = {
         bundles: {},
         bundlesRoute: {},
         extendBundles: {},
         excludedCSS: {},
         superBundles: {}
      },
      excludedCSS = {};

   let
      cssModulesFromOrderQueue = [],
      bundlePath = helpers.removeLeadingSlashes(packagePath),
      orderQueue;

   /**
    * for extendable bundles meta we need to store real paths
    * of generated packages.
    */
   if (resourcesUrl && !packageConfig.extendsTo) {
      bundlePath = `resources/${bundlePath}`;
   }
   if (!checkConfigForIncludeOption(packageConfig)) {
      throw new Error('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   }

   orderQueue = packHelpers.getOrderQueue(
      depsTree,
      packageConfig,
      excludedCSS,
      rootForCache
   ).filter((node) => {
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

   const cssPackagesNames = new Map();
   if (cssModulesFromOrderQueue.css.length > 0) {
      const
         projectThemes = (taskParameters.cache && Object.keys(taskParameters.cache.currentStore.styleThemes)) || [],
         splittedCssByThemes = splitCssByThemes(
            cssModulesFromOrderQueue.css,
            projectThemes,
            taskParameters.compiledLessByModules,
            helpers.prettifyPath(rootForCache),
            moduleName
         );

      const cssExternalModuleUsageMessages = new Set();

      await pMap(
         Object.keys(splittedCssByThemes),
         async(themeName) => {
            const cssRes = await customPackCSS(
               splittedCssByThemes[themeName]
                  .map(function onlyPath(cssName) {
                     const currentCssPath = helpers.unixifyPath(path.join(
                        rootForCache,
                        `${cssName}.min.css`
                     ));
                     const cssIsPackageOutput = currentCssPath === outputFile.replace(/\.js$/, '.css');

                     const currentFileModuleName = cssName.split('/').shift();
                     if (
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
               taskParameters.config.cachePath ? `${taskParameters.config.cachePath}/incremental_build` : root,
               taskParameters.config.applicationForRebase
            );
            await fs.outputFile(
               `${pathToCustomCSS}${themeName ? `_${themeName}` : ''}` +
               `${cssExtIncludesPackage ? '.package' : ''}.min.css`,
               cssRes
            );

            /**
             * get all saved extendable css packages(common and themed)
             * to save it into apropriated root custom css package
             */
            if (packageConfig.extendsTo) {
               const extendCssPath = pathToCustomCSS.replace(helpers.prettifyPath(root), '');
               const extendsToNormalized = packageConfig.extendsTo.replace(/(\.package)?(\.js)$/, '');
               cssPackagesNames.set(
                  helpers.removeLeadingSlashes(
                     `${extendCssPath}${themeName ? `_${themeName}` : ''}.package.min.css`
                  ),
                  helpers.removeLeadingSlashes(
                     `${extendsToNormalized}${themeName ? `_${themeName}` : ''}.package.min.css`
                  )
               );
            }

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
      const bundleList = (await packHelpers.generateBundle(
         orderQueue,
         cssModulesFromOrderQueue.css
      )).sort();
      if (packageConfig.extendsTo) {
         const normalizedExtendOutput = helpers.removeLeadingSlashes(
            packageConfig.extendsTo
         ).replace(/\.js$/, '.min');
         result.extendBundles[`${bundlePath}.js`] = {
            extendsTo: `${normalizedExtendOutput}.js`,
            modules: bundleList,
            config: `${packageConfig.path}:${packageConfig.output}`
         };
         cssPackagesNames.forEach((value, key) => {
            result.extendBundles[key] = {
               extendsTo: `${value}`,
               config: `${packageConfig.path}:${packageConfig.output}`
            };
         });
      } else {
         const cssBundlePath = pathToCustomCSS.replace(helpers.unixifyPath(applicationRoot), '');
         result.bundles[bundlePath] = bundleList;
         result.bundlesRoute = packHelpers.generateBundlesRouting(
            result.bundles[bundlePath],
            bundlePath,
            {
               cssExtIncludesPackage,
               cssBundlePath,
               excludedCSS,
               resourcesUrl,
               superBundles: result.superBundles,
               isSuperBundle: !!packageConfig.includePackages
            }
         );

         /**
          * if module was packed into package, we must remove excluded css with the same name as module
          * from excluded css meta
          */
         Object.keys(excludedCSS).forEach((currentKey) => {
            const nodeName = currentKey.split(/!|\?/).pop();
            if (!result.bundles[bundlePath].includes(nodeName)) {
               delete excludedCSS[currentKey];
            }
         });
      }
   }

   packageConfig.orderQueue = orderQueue;
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
      result.bundlesRoute
   );
}

/**
 * reads common ws.core bundles meta if exists, otherwise
 * returns defaults
 * @param applicationRoot
 * @returns {Promise<void>}
 */
async function readWSCoreBundlesMeta(wsCorePaths) {
   const { wsCoreBundlesPath, wsCoreBundlesRoutePath } = wsCorePaths;
   const result = {};
   if (await fs.pathExists(wsCoreBundlesPath)) {
      result.wsCoreBundles = await fs.readJson(wsCoreBundlesPath);
   } else {
      result.wsCoreBundles = {};
   }
   if (await fs.pathExists(wsCoreBundlesRoutePath)) {
      result.wsCoreBundlesRoute = await fs.readJson(wsCoreBundlesRoutePath);
   } else {
      result.wsCoreBundlesRoute = {};
   }
   return result;
}

/**
 * join moduled extendable bundles into common root bundle.
 * Add result into "bundles" and "bundlesRoute" meta
 * Temporarily save it into WS.Core until the time when jinnee
 * will be able to join extendable bundles by itself
 * @param{Object} extendBundles - extendable bundles meta for join
 * @param{String} applicationRoot - root of current project
 * @returns {Promise<void>}
 */
async function joinAndSaveExtendableBundles(extendBundles, applicationRoot, result) {
   const wsCorePaths = {
      wsCoreBundlesPath: path.join(applicationRoot, 'WS.Core', 'bundles.json'),
      wsCoreBundlesRoutePath: path.join(applicationRoot, 'WS.Core', 'bundlesRoute.json')
   };
   const { wsCoreBundles, wsCoreBundlesRoute } = await readWSCoreBundlesMeta(wsCorePaths);
   await pMap(
      Object.keys(extendBundles),
      async(currentExtendBundle) => {
         const currentBundleContentParts = {};

         // read all moduled extendable bundles to join it into common bundle
         await pMap(
            Object.keys(extendBundles[currentExtendBundle].content),
            async(currentContentIndex) => {
               const currentContentName = extendBundles[currentExtendBundle].content[currentContentIndex];
               const currentContent = await fs.readFile(
                  path.join(applicationRoot, currentContentName),
                  'utf8'
               );
               currentBundleContentParts[
                  `/* ${extendBundles[currentExtendBundle].config[currentContentName]} */`
               ] = currentContent;
            }
         );
         const currentBundleContent = [];
         Object.keys(currentBundleContentParts).sort().forEach(
            key => currentBundleContent.push(key, currentBundleContentParts[key])
         );
         const bundleWithoutRoot = helpers.prettifyPath(
            helpers.removeLeadingSlashes(
               currentExtendBundle.replace(applicationRoot, '')
            )
         );

         // save into WS.Core bundles current joined supebundle
         const currentBundleList = extendBundles[currentExtendBundle].modules;
         if (currentBundleList && currentBundleList.length > 0) {
            const wsCoreFormattedBundle = `resources/WS.Core/${bundleWithoutRoot.replace(/\.js$/, '')}`;
            wsCoreBundles[wsCoreFormattedBundle] = currentBundleList;

            // add modules from joined superbundle to bundlesRoute meta(for presentation service)
            currentBundleList.forEach((currentModule) => {
               if (currentModule.startsWith('css!')) {
                  wsCoreBundlesRoute[currentModule] = `${wsCoreFormattedBundle}.css`;
                  result.bundlesRoute[currentModule] = `${wsCoreFormattedBundle}.css`;
               } else {
                  wsCoreBundlesRoute[currentModule] = `${wsCoreFormattedBundle}.js`;
                  result.bundlesRoute[currentModule] = `${wsCoreFormattedBundle}.js`;
               }
            });
         }
         await fs.outputFile(
            path.join(applicationRoot, 'WS.Core', bundleWithoutRoot),
            currentBundleContent.join('\n')
         );
      }
   );

   await fs.outputJson(wsCorePaths.wsCoreBundlesPath, wsCoreBundles);
   await fs.outputJson(wsCorePaths.wsCoreBundlesRoutePath, wsCoreBundlesRoute);
}

/**
 * joined moduled extend bundles meta into joined project
 * extend bundles meta
 * @param{Object} jsonToWrite - bundles meta file to save into output
 * @param{String} applicationRoot - current project root
 * @param{Object} extendBundles - moduled extendable bundles meta
 * @returns {Promise<void>}
 */
async function generateCommonExtendBundles(jsonToWrite, applicationRoot, extendBundles) {
   const result = {};
   await pMap(
      Object.keys(extendBundles),
      async(currentExtendBundle) => {
         const intModuleName = currentExtendBundle.match(/(^resources\/)?([^/]+)/)[2];
         const bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, 'extend-bundles.json'));
         if (await fs.pathExists(bundlesPath)) {
            jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
         }
         if (!jsonToWrite[bundlesPath]) {
            jsonToWrite[bundlesPath] = {};
         }
         jsonToWrite[bundlesPath][currentExtendBundle] = extendBundles[currentExtendBundle];

         const prettyExtendsTo = helpers.prettifyPath(
            extendBundles[currentExtendBundle].extendsTo
         );
         if (!result[prettyExtendsTo]) {
            result[prettyExtendsTo] = {
               content: new Set(),
               modules: new Set(),
               config: {},
            };
         }

         result[prettyExtendsTo].content.add(currentExtendBundle);
         result[prettyExtendsTo].config[currentExtendBundle] = extendBundles[currentExtendBundle].config;
         if (extendBundles[currentExtendBundle].modules) {
            extendBundles[currentExtendBundle].modules.forEach(
               currentModule => result[prettyExtendsTo].modules.add(currentModule)
            );
         }
      },
      {
         concurrency: 10
      }
   );
   Object.keys(result).forEach((currentKey) => {
      result[currentKey].content = [...result[currentKey].content];
      result[currentKey].modules = [...result[currentKey].modules];
   });
   return result;
}

/**
 * Функция, которая сплитит результат работы таски custompack в секции bundles
 */
async function saveBundlesForEachModule(taskParameters, applicationRoot, result, modulesForPatch) {
   const jsonToWrite = {};

   /**
    * dont save bundlesRoute if sources flag disabled. There is no need in usage
    * of this meta in desktop applications.
    */
   if (taskParameters.config.sources) {
      const superBundles = Object.keys(result.superBundles);
      await pMap(
         Object.keys(result.bundlesRoute),
         async(currentModule) => {
            const
               moduleNameWithoutPlugins = normalizeModuleName(currentModule.split(/!|\?/).pop());

            let intModuleName;
            if (superBundles.includes(result.bundlesRoute[currentModule])) {
               [, , intModuleName] = result.bundlesRoute[currentModule].match(/(^resources\/)?([^/]+)/);
            } else if (moduleNameWithoutPlugins.includes('/')) {
               intModuleName = moduleNameWithoutPlugins.split('/').shift();
            } else {
               // single-named modules is requirejs plugins, in this case write results to WS.Core
               intModuleName = 'WS.Core';
            }

            /**
             * save bundlesRoute into moduled bundlesRoute in this cases:
             * 1)full static build - save without exclusions.
             * 2)patch static build - save results only for patching modules
             */
            if (modulesForPatch.length === 0 || modulesForPatch.includes(intModuleName)) {
               const
                  bundlesRoutePath = path.normalize(path.join(applicationRoot, intModuleName, 'bundlesRoute.json'));

               if ((await fs.pathExists(bundlesRoutePath))) {
                  jsonToWrite[bundlesRoutePath] = await fs.readJson(bundlesRoutePath);
               }

               if (!jsonToWrite[bundlesRoutePath]) {
                  jsonToWrite[bundlesRoutePath] = {};
               }

               if (!result.excludedCSS.hasOwnProperty(currentModule)) {
                  if (jsonToWrite[bundlesRoutePath].hasOwnProperty(currentModule)) {
                     jsonToWrite[bundlesRoutePath][currentModule].concat(result.bundlesRoute[currentModule]);
                  } else {
                     jsonToWrite[bundlesRoutePath][currentModule] = result.bundlesRoute[currentModule];
                  }
               }
               jsonToWrite[bundlesRoutePath][currentModule] = result.bundlesRoute[currentModule];
            }
         },
         {
            concurrency: 10
         }
      );
   }

   /**
    * write bundles meta by interface modules names.
    */
   await pMap(
      Object.keys(result.bundles),
      async(currentBundle) => {
         const intModuleName = currentBundle.match(/(^resources\/)?([^/]+)/)[2];
         const bundlesPath = path.normalize(path.join(applicationRoot, intModuleName, 'bundles.json'));

         if (await fs.pathExists(bundlesPath)) {
            jsonToWrite[bundlesPath] = await fs.readJson(bundlesPath);
         }

         if (!jsonToWrite[bundlesPath]) {
            jsonToWrite[bundlesPath] = {};
         }

         jsonToWrite[bundlesPath][currentBundle] = result.bundles[currentBundle];
      },
      {
         concurrency: 10
      }
   );
   const needToSaveExtendBundlesMeta = Object.keys(result.extendBundles).length > 0;

   let commonExtendBundles = {};

   // if results have extendable bundles meta, save it.
   if (needToSaveExtendBundlesMeta) {
      commonExtendBundles = await generateCommonExtendBundles(
         jsonToWrite,
         applicationRoot,
         result.extendBundles
      );
      await fs.outputJson(path.join(applicationRoot, 'common-extend-bundles.json'), commonExtendBundles);
   }
   await pMap(Object.keys(jsonToWrite), key => fs.outputJson(key, sortObjectByKeys(jsonToWrite[key])), {
      concurrency: 10
   });

   if (needToSaveExtendBundlesMeta) {
      await joinAndSaveExtendableBundles(commonExtendBundles, helpers.prettifyPath(applicationRoot), result);
   }
}

/**
 * Сохраняем результаты работы кастомной паковки для всех секций.
 */
async function saveModuleCustomPackResults(taskParameters, result, applicationRoot, modulesForPatch) {
   await saveBundlesForEachModule(taskParameters, applicationRoot, result, modulesForPatch);

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
         const currentLibraries = taskParameters.librariesMeta[currentModule];

         // skip saving libraries meta into bundlesRoute if there is nothing to save
         if (currentLibraries.length > 0) {
            const currentBundlesRoutePath = path.join(applicationRoot, currentModule, 'bundlesRoute.json');
            let currentBundlesRoute = {};
            if (await fs.pathExists(currentBundlesRoutePath)) {
               currentBundlesRoute = await fs.readJson(currentBundlesRoutePath);
            }
            currentLibraries.forEach((currentLibrary) => {
               // dont write libraries into bundlesRoute meta if packed into custom package
               if (!result.bundlesRoute[currentLibrary]) {
                  const normalizedLibraryPath = `${taskParameters.config.resourcesUrl ? 'resources/' : '/'}${currentLibrary}.min.js`;
                  currentBundlesRoute[currentLibrary] = normalizedLibraryPath;
               }
            });
            await fs.outputJson(currentBundlesRoutePath, currentBundlesRoute);
         }
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
      excludedCSS: {},
      extendBundles: {},
      superBundles: {}
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
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'extendBundles');
   packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'superBundles');
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
   const modulesForPatch = [];
   await pMap(
      taskParameters.config.modules,
      async(moduleInfo) => {
         const moduleName = transliterate(path.basename(moduleInfo.output));
         if (moduleInfo.rebuild) {
            modulesForPatch.push(moduleName);
         }
         const rootCache = taskParameters.config.cachePath ? `${taskParameters.config.cachePath}/incremental_build` : root;
         const metaPath = path.join(rootCache, moduleName, '.builder/compiled-less.min.json');
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

   /**
    * store "modules for patch" info into results. Needed by packages intercepts
    * collector - dont analize intercepts in non-patching modules.
    */
   results.modulesForPatch = modulesForPatch;
   await pMap(
      configsArray,
      async(currentConfig) => {
         const moduleName = helpers.removeLeadingSlashes(currentConfig.path).split('/').shift();

         /**
          * in patch build skip package configs from non-patching interface modules.
          * They needs only to get proper info for superbundles in patching modules.
          */
         if (modulesForPatch.length > 0 && !modulesForPatch.includes(moduleName)) {
            return;
         }
         await compileCurrentPackage(taskParameters, depsTree, currentConfig, results, root);
      },
      {
         concurrency: 10
      }
   );

   /**
    * sort bundlesRoute meta values in descending order to get equal results in full and patch builds
    */
   Object.keys(results.bundlesRoute).forEach((currentKey) => {
      [results.bundlesRoute[currentKey]] = helpers.descendingSort(results.bundlesRoute[currentKey]);
   });
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
 * @param {Array} modulesForPatch модули для сборки патча
 * @param {String} root корень приложения
 * @param {Array[][]} intersects пересечения между кастомными пакетами
 * @returns {Promise<void>}
 */
async function splitIntersectsByUiModuleName(modulesForPatch, root, intersects) {
   const intersectsByUiModules = {};

   intersects.forEach((currentEntry) => {
      const
         currentModule = currentEntry[0],
         currentModuleIntersect = currentEntry[1].sort(),
         interfaceModule = getUiModuleName(currentModule);

      // ignore intersects for non-patching modules
      if (modulesForPatch.length > 0 && !modulesForPatch.includes(interfaceModule)) {
         return;
      }
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
      { bundles, modulesForPatch } = results,
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
      modulesForPatch,
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
async function setSuperBundle(configs, root, modulesForPatch) {
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
               currentSuperBundle.packagesRules[currentPackagePath] = {};
               if (neededPackage.include && neededPackage.include.length > 0) {
                  currentSuperBundle.include.splice(currentSuperBundle.include.length, 0, ...neededPackage.include);
                  currentSuperBundle.packagesRules[currentPackagePath].include = neededPackage.include;
               }
               if (neededPackage.exclude && neededPackage.exclude.length > 0) {
                  currentSuperBundle.exclude.splice(currentSuperBundle.exclude.length, 0, ...neededPackage.exclude);
                  currentSuperBundle.packagesRules[currentPackagePath].exclude = neededPackage.exclude;
               }
               delete commonBundles[fullPackageName];
            }
         });
         if (currentSuperBundle.includeCore && !currentSuperBundle.modules) {
            currentSuperBundle.modules = currentSuperBundle.include;
         }
         currentSuperBundle.exclude = filterBadExcludeRules(currentSuperBundle);

         const currentModuleName = helpers.removeLeadingSlashes(path.dirname(currentSuperBundle.path));
         if (modulesForPatch.length > 0 && !modulesForPatch.includes(currentModuleName)) {
            return;
         }

         /**
          * remove rebuild flag from meta for superbundle config to pass diffs between full build
          * and build for patch
          */
         const currentSuperBundleMeta = { ...currentSuperBundle };
         if (currentSuperBundleMeta.hasOwnProperty('moduleInfo')) {
            delete currentSuperBundleMeta.moduleInfo;
         }

         /**
          * Сохраним конфигурацию для пакета, чтобы впоследствии мы могли посмотреть на конечную
          * конфигурацию супербандла для паковки со всеми правилами.
          */
         await fs.outputJson(
            path.join(root, currentModuleName, `.builder/${currentSuperBundle.output}.package.json`),
            currentSuperBundleMeta
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
