'use strict';

const path = require('path');
const dblSlashes = /\\/g;
const commonPackage = require('../../../packer/lib/common-package');
const excludeCore = ['Core/*', 'Deprecated/*', 'Transport/*'];

/**
 * набор модулей, которые не должны попадать в пакет
 * в связи с их исключением из процесса минификации
 */
const excludeRegexes = [
   /.*\.worker\.js$/,
   /.*[/\\]node_modules[/\\].*/,
   /.*[/\\]ServerEvent[/\\]worker[/\\].*/,
];
const pMap = require('p-map');
const fs = require('fs-extra');
const helpers = require('../../../lib/helpers');

/**
 * Путь до original файла
 * @param {String} filePath
 * @return {string}
 */
function originalPath(filePath) {
   return filePath.indexOf('.original.') > -1 ? filePath : filePath.replace(/(\.js)$/, '.original$1');
}

/**
 * Путь до выходного файла
 */
function getOutputFile(packageConfig, applicationRoot, depsTree) {
   const mDepsPath = depsTree.getNodeMeta(packageConfig.output).path;
   let outputFile;

   if (mDepsPath) {
      outputFile = mDepsPath;
   } else {
      outputFile = path.join(path.dirname(packageConfig.path), path.normalize(packageConfig.output));
      outputFile = outputFile.replace(/(\.js)$/, '.min$1');
   }
   return path.join(path.normalize(applicationRoot), outputFile).replace(dblSlashes, '/');
}

/**
 * Экранируем строку для RegExp
 * @param {String} str
 * @return {string}
 */
function escapeRegExp(str) {
   return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
}

/**
 * Экранируем строку для RegExp без экранирования *, она заменена на .*
 * @param {String} str
 * @return {string}
 */
function escapeRegExpWithoutAsterisk(str) {
   return str.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&').replace('*', '.*');
}

/**
 * Формируем RegExp для фильтрации модулей
 * @param {Array} modules
 * @return {RegExp}
 */
function generateRegExp(modules) {
   let regexpStr = '';

   if (!modules || !modules.length) {
      return null;
   }

   modules.forEach((module) => {
      if (typeof module !== 'string') {
         return;
      }

      if (module.indexOf('*') > -1) {
         regexpStr += `${regexpStr ? '|' : ''}^(.+?!)?(${escapeRegExpWithoutAsterisk(module)})`;
      } else {
         regexpStr += `${regexpStr ? '|' : ''}^(.+?!)?(${escapeRegExp(module)}$)`;
      }
   });

   return new RegExp(`${regexpStr}`);
}

/**
 * Получаем список вершин
 * @param {DepGraph} dg
 * @param {Array} modules
 * @return {Array}
 */
function findAllModules(dg, modules) {
   const nodes = dg.getNodes();
   const regexp = generateRegExp(modules);

   return nodes.filter(node => regexp.test(node));
}

/**
 * Проверяем путь на наличие исключения
 * @param fullPath - путь до файла
 * @returns {boolean}
 */
function testForExcludeRegexes(fullPath) {
   let result = false;
   excludeRegexes.forEach((regex) => {
      if (regex.test(fullPath)) {
         result = true;
      }
   });
   return result;
}

/**
 * Получаем отфильтрованный граф
 * @param {DepGraph} depsTree - дерево зависимостей module-dependencies
 * @param {Object} cfg - текущая конфигурация для кастомной паковки
 * @param {Object} excludedCSS - набор css, которые были выброшены из пакетов через exclude
 * @param {String} applicationRoot - полный путь до корня сервиса
 * @return {Array}
 */
function getOrderQueue(depsTree, cfg, excludedCSS, applicationRoot) {
   let excludeCoreReg;

   // если особый пакет(вебинары), то оставляем старый способ паковки
   if (!cfg.includeCore && cfg.modules) {
      cfg.modules.forEach((expression) => {
         if (!cfg.include.includes(expression)) {
            cfg.include.push(expression);
         }
      });
      excludeCoreReg = generateRegExp(excludeCore);
   }
   const modules = findAllModules(depsTree, !cfg.includeCore && !cfg.modules ? cfg.include : cfg.modules);
   const include = generateRegExp(cfg.include);
   const exclude = generateRegExp(cfg.exclude);

   const orderQueue = depsTree.getLoadOrder(modules);

   return commonPackage
      .prepareOrderQueue(depsTree, orderQueue, applicationRoot)
      .filter(module => !testForExcludeRegexes(module.fullPath))
      .filter(module => (include ? include.test(module.fullName) : true))
      .filter((module) => {
         if (exclude && exclude.test(module.fullName)) {
            if (module.fullName.startsWith('css!')) {
               excludedCSS[module.fullName] = module.fullName;
            }
            return false;
         }
         if (excludeCoreReg) {
            return !excludeCoreReg.test(module.fullName);
         }
         return true;
      });
}

/**
 * Получаем физический путь для названия пакета
 * @param {String} currentOutput - физический путь до пакета
 * @param {String} applicationRoot - корень сервиса
 * @returns {*}
 */
function getBundlePath(currentOutput, applicationRoot) {
   const result = currentOutput.replace(applicationRoot.replace(/\\/g, '/'), '');
   return result.replace(/\\/g, '/').replace(/\.js/g, '');
}

/**
 * Проверяет наличие стиля или шаблона в списке на запись
 * @param module - Полное имя модуля(с плагинами)
 * @param orderQueue - список модулей на запись
 */
function checkForIncludeInOrderQueue(module, orderQueue) {
   const moduleWithoutPlugin = module.split('!').pop(),
      founded = {};

   const checkModule = (currentModule) => {
      const currentModuleParts = new Set(currentModule.fullName.split('!'));
      if (currentModuleParts.has(moduleWithoutPlugin)) {
         if (currentModuleParts.has('css')) {
            founded.css = true;
         }
         if (currentModuleParts.has('tmpl')) {
            founded.tmpl = true;
         }
         if (currentModuleParts.has('html')) {
            founded.xhtml = true;
         }
      }
   };

   orderQueue.forEach(node => checkModule(node));
   return founded;
}

/**
 * проверяем, сгенерирован ли шаблон и стоит ли его включать в пакет.
 * P.S. эта функция работает исключительно для анонимных шаблонов, которые
 * любят глубоко в callback тянуть через require
 * @param templatePath
 */
async function checkTemplateForAMD(templatePath) {
   const data = await fs.readFile(templatePath, 'utf8');
   return data.indexOf('define(') === 0;
}

/**
 * Генерирует кастомный пакет для requirejs конфигурации.
 * @param {Object} orderQueue - очередь модулей на запись в пакет.
 * @return {Array}
 */
async function generateBundle(orderQueue, cssModulesFromOrderQueue) {
   const bundle = [],
      moduleExtReg = /(\.module)?(\.min)?(\.original)?\.js$/,
      modulesToPushToOrderQueue = [];

   /**
    * в bundles непосредственно css должны остаться на случай динамического запроса пакетов
    */
   cssModulesFromOrderQueue.forEach(css => bundle.push(css.fullName));
   await pMap(
      orderQueue,
      async(node) => {
         const isJSModuleWithoutJSPlugin = node.fullName.indexOf('!') === -1 && node.plugin === 'js';
         let modulePath;
         if (node.fullPath) {
            modulePath = node.fullPath;
         } else {
            modulePath = node.moduleYes.fullPath ? node.moduleYes.fullPath : node.moduleNo.fullPath;
         }

         /**
          * we need to check for existing in file system minimized and compiled styles.
          * In desktop applications sources deleted and we can confirm module existance only
          * by minified version
          */
         const moduleHaveTmpl = await fs.pathExists(modulePath.replace(moduleExtReg, '.min.tmpl')),
            moduleHaveXhtml = await fs.pathExists(modulePath.replace(moduleExtReg, '.min.xhtml')),
            moduleHaveCSS = await fs.pathExists(modulePath.replace(moduleExtReg, '.min.css'));

         if (node.amd) {
            /**
             * Если модуль без плагина js и у него есть шаблон или стиль, мы должны удостовериться,
             * что они также попадут в бандлы и будут запакованы, иначе require будет вызывать
             * кастомный пакет, но с соответствующим расширением
             */
            if (isJSModuleWithoutJSPlugin && (moduleHaveTmpl || moduleHaveXhtml || moduleHaveCSS)) {
               const foundedElements = checkForIncludeInOrderQueue(node.fullName, orderQueue);
               let config;
               if (moduleHaveTmpl && !foundedElements.tmpl) {
                  config = {
                     fullName: `tmpl!${node.fullName}`,
                     fullPath: modulePath.replace(moduleExtReg, '.min.tmpl'),
                     plugin: 'tmpl'
                  };
                  config.amd = await checkTemplateForAMD(config.fullPath);
                  modulesToPushToOrderQueue.push(config);
               }
               if (moduleHaveXhtml && !foundedElements.xhtml) {
                  config = {
                     fullName: `tmpl!${node.fullName}`,
                     fullPath: modulePath.replace(moduleExtReg, '.min.xhtml'),
                     plugin: 'html',
                     amd: true
                  };
                  config.amd = await checkTemplateForAMD(config.fullPath);
                  modulesToPushToOrderQueue.push(config);
               }
               if (moduleHaveCSS && !foundedElements.css) {
                  /**
                   * Проверяем наш список css на наличие подходящего имени и в случае его
                   * наличия не надо добавлять в orderQueue на запись.
                   */
                  const foundedCSSFromList = cssModulesFromOrderQueue.find(css => css.fullName.includes(`css!${node.fullName}`));
                  if (!foundedCSSFromList) {
                     modulesToPushToOrderQueue.push({
                        fullName: `css!${node.fullName}`,
                        fullPath: modulePath.replace(moduleExtReg, '.min.css'),
                        plugin: 'css'
                     });
                  }
               }
            }
            bundle.push(node.fullName);
         } else if (node.plugin === 'css' || node.plugin === 'text') {
            bundle.push(node.fullName);
         }
      },
      {
         concurrency: 10
      }
   );

   modulesToPushToOrderQueue.forEach((module) => {
      if (!bundle.includes(module.fullName)) {
         bundle.push(module.fullName);
      }
      orderQueue.push(module);
   });
   return bundle;
}

/**
 * Генерирует список: модуль и путь до пакета, в котором он лежит
 * @param currentBundle - текущий бандл
 * @param pathToBundle - физический путь до бандла
 * @param bundlesRoutingObject - результирующий список
 */
function generateBundlesRouting(currentBundle, pathToBundle, cssBundleConfig) {
   const
      bundlesRoute = {},
      {
         cssExtIncludesPackage,
         cssBundlePath,
         excludedCSS,
         resourcesUrl,
         isSuperBundle,
         superBundles
      } = cssBundleConfig;

   const rebasedBundlePath = resourcesUrl ? path.join('resources', cssBundlePath) : cssBundlePath;
   for (let i = 0; i < currentBundle.length; i++) {
      if (currentBundle[i].indexOf('css!') === 0) {
         if (!excludedCSS.hasOwnProperty(currentBundle[i])) {
            const pathToPackage = `${helpers.unixifyPath(rebasedBundlePath)}` +
               `${cssExtIncludesPackage ? '.package' : ''}.min.css`;
            bundlesRoute[currentBundle[i]] = pathToPackage;

            /**
             * save information about superbundles.
             * It will be used for proper saving of bundlesRoute meta in patches of Modules with superbundles
             */
            if (isSuperBundle) {
               superBundles[pathToPackage] = pathToPackage;
            }
         }
      } else {
         bundlesRoute[currentBundle[i]] = `${pathToBundle}.js`;
         if (isSuperBundle) {
            superBundles[`${pathToBundle}.js`] = `${pathToBundle}.js`;
         }
      }
   }
   return bundlesRoute;
}

/**
 * Обходим конфигурационные файлы, складываем все содержащиеся внутри объекты в configsArray
 * По каждому объекту будет создан свой пакет.
 * @param {Array} configsFiles - json-файлы формата name.package.json
 * @return {Array}
 */
function getConfigsFromPackageJson(configPath, cfgContent, moduleInfo) {
   const
      configsArray = [],
      packageName = path.basename(configPath);

   if (cfgContent instanceof Array) {
      for (let i = 0; i < cfgContent.length; i++) {
         const cfgObj = cfgContent[i];
         cfgObj.packageName = packageName;
         cfgObj.configNum = i + 1;
         cfgObj.path = configPath;
         cfgObj.moduleInfo = moduleInfo;
         configsArray.push(cfgObj);
      }
   } else {
      cfgContent.packageName = packageName;
      cfgContent.path = configPath;
      cfgContent.moduleInfo = moduleInfo;

      configsArray.push(cfgContent);
   }

   return configsArray;
}

/**
 * Генерим код для правильного подключения кастомных css-пакетов
 * Аппендим линку с версией для кэширования, и дефайним все css
 * модули пустышками, чтобы они не затянулись отдельно через require
 * TODO надо будет доработать с Никитой, чтобы я не аппендил линки, если он уже зааппендил
 * в момент серверной вёрстки(какой нибудь аттрибут?например cssBundles).
 * @param cssModules - список всех css-модулей
 * @param packagePath - путь до пакета
 * @returns {string}
 */
function generateLinkForCss(cssModules, packagePath) {
   let linkHref = packagePath.replace(/\.min$/, '');
   linkHref = linkHref.replace(/(^resources\/)|(^\/)/, '');
   let result = '(function(){';
   const packageSuffix = linkHref.endsWith('.package');

   if (packageSuffix) {
      linkHref = linkHref.replace(/\.package$/, '');
   }
   helpers.descendingSort(cssModules, 'fullName').forEach((module) => {
      result += `define('${module.fullName}',['css!${linkHref}` +
         `${module.currentTheme ? `_${module.currentTheme}` : ''}${packageSuffix ? '.package' : ''}'],'');`;
   });
   return `${result}})();`;
}

/**
 * join bundles meta for current generated custom package
 * into common project bundles meta
 * @param{Object} current - current meta
 * @param{Object} common - common meta
 * @param{String} idProperty - meta type(bundles, bundlesRoute or extendBundles)
 */
function appendBundlesOptionsToCommon(current, common, idProperty) {
   switch (idProperty) {
      case 'extendBundles':
         Object.keys(current[idProperty]).forEach((key) => {
            if (!common[idProperty][key]) {
               common[idProperty][key] = {
                  extendsTo: current[idProperty][key].extendsTo,
                  modules: current[idProperty][key].modules,
                  config: current[idProperty][key].config
               };
            } else {
               common[idProperty][key].modules = common[idProperty][key].modules.concat(
                  [...current[idProperty][key].modules]
               );
            }
         });
         break;
      case 'bundlesRoute':
         Object.keys(current[idProperty]).forEach((key) => {
            if (!common[idProperty][key]) {
               common[idProperty][key] = [];
            }
            common[idProperty][key].push(current[idProperty][key]);
         });
         break;
      default:
         Object.keys(current[idProperty]).forEach((key) => {
            common[idProperty][key] = current[idProperty][key];
         });
         break;
   }
}

module.exports = {
   appendBundlesOptionsToCommon,
   getOrderQueue,
   getOutputFile,
   getConfigsFromPackageJson,
   getBundlePath,
   generateBundle,
   generateBundlesRouting,
   generateLinkForCss,
   originalPath
};
