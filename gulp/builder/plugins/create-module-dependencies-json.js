/**
 * Плагин для создания module-dependencies.json (зависимости компонентов и их расположение. для runtime паковка)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate'),
   fs = require('fs-extra'),
   modulePathToRequire = require('../../../lib/modulepath-to-require');

const INTERCEPT_IGNORE = [

   /**
    * I18n interceptions cannot be solved, because those are aspects of
    * each language locale(e.g. en-GB, en-US for english) and they must be
    * packed with each one language. For this issue possible solutions are:
    * 1) use aspects as external dependencies - will cause overhead of requests for
    * each language aspect
    * 2) create a common library for these aspects - there will be overhead of transferred
    * data due to useless aspects in library.
    */
   'I18n',

   /**
    * It's a wasaby-dev-tools module and it builds by builder only in tests,
    * so there is no need in libraries intersections check
    */
   'injection'
];

// плагины, которые должны попасть в links
const supportedPluginsForLinks = new Set([
   'is',
   'html',
   'css',
   'json',
   'xml',
   'text',
   'native-css',
   'browser',
   'optional',
   'i18n',
   'tmpl',
   'wml',
   'cdn',
   'preload',
   'remote'
]);

// стандартные модули, которые и так всегда есть
const excludeSystemModulesForLinks = new Set(['module', 'require', 'exports']);

// нужно добавить эти плагины, но сами зависимости добавлять в links не нужно
const pluginsOnlyDeps = new Set(['cdn', 'preload', 'remote']);

const { stylesToExcludeFromMinify } = require('../../../lib/builder-constants');

const parsePlugins = dep => [
   ...new Set(
      dep
         .split('!')
         .slice(0, -1)
         .map((depName) => {
            if (depName.includes('?')) {
               return depName.split('?')[1];
            }
            return depName;
         })
   )
];

/**
 * Получаем набор файлов css и jstpl для последующего
 * добавления в module-dependencies
 * @param inputFiles - список всех файлов текущего Интерфейсного модуля
 * @returns {Array[]}
 */
function getCssAndJstplFiles(inputFiles) {
   const
      cssFiles = [],
      jstplFiles = [];

   inputFiles.forEach((filePath) => {
      /**
       * private less(starts with "_") and styles excluded from minification task
       * should be excluded from module-dependencies
       */
      if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
         if (path.basename(filePath).startsWith('_')) {
            return;
         }

         for (const regex of stylesToExcludeFromMinify) {
            if (regex.test(filePath)) {
               return;
            }
         }
         cssFiles.push(filePath.replace('.less', '.css'));
      }
      if (filePath.endsWith('.jstpl')) {
         jstplFiles.push(filePath);
      }
   });
   return [cssFiles, jstplFiles];
}

function getNodePath(prettyPath, ext, suffix) {
   let result = prettyPath;

   // An AMD-module formatted json generates, so there should be corresponding path for it
   if (ext === '.json') {
      return prettyPath.replace(ext, `${ext}${suffix}.js`);
   }

   if (!prettyPath.endsWith(`${suffix}${ext}`)) {
      result = prettyPath.replace(ext, `${suffix}${ext}`);
   }

   if (ext === '.ts') {
      return result.replace(/(\.ts|\.es)$/, '.js');
   }
   return result;
}

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   // suffix of minimization. It'll be inserted if minimize is enabled and there isn't debugCustomPack enabled.
   const suffix = !taskParameters.config.debugCustomPack ? '.min' : '';
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         callback(null, file);
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      async function onFlush(callback) {
         const startTime = Date.now();
         const addAdditionalMeta = taskParameters.config.branchTests;
         try {
            const { resourcesUrl } = taskParameters.config;
            const packedPrivateModules = {};
            const json = {
               links: {},
               nodes: {},
               packedLibraries: {}
            };
            if (addAdditionalMeta) {
               if (!json.lessDependencies) {
                  json.lessDependencies = {};
               }
               if (!json.requireJsSubstitutions) {
                  json.requireJsSubstitutions = {};
               }
            }
            const storeNode = (mDeps, nodeName, objectToStore, relativePath) => {
               const ext = path.extname(relativePath);
               const rebasedRelativePath = resourcesUrl ? path.join('resources', relativePath) : relativePath;
               const prettyPath = helpers.prettifyPath(transliterate(rebasedRelativePath));


               objectToStore.path = getNodePath(prettyPath, ext, suffix);
               mDeps.nodes[nodeName] = objectToStore;

               /**
                * WS.Core interface module only has actual requirejs substitutions.
                * Store all of these for branch tests.
                 */
               if (moduleInfo.name === 'WS.Core' && addAdditionalMeta) {
                  mDeps.requireJsSubstitutions[`${nodeName}`] = helpers.unixifyPath(relativePath);
               }
            };
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            Object.keys(componentsInfo).forEach((relativePath) => {
               const info = componentsInfo[relativePath];
               if (info.hasOwnProperty('componentName')) {
                  const depsOfLink = new Set();
                  if (info.hasOwnProperty('componentDep')) {
                     for (const dep of info.componentDep) {
                        let skipDep = false;
                        for (const plugin of parsePlugins(dep)) {
                           if (supportedPluginsForLinks.has(plugin)) {
                              depsOfLink.add(plugin);
                           }
                           if (pluginsOnlyDeps.has(plugin)) {
                              skipDep = true;
                           }
                        }
                        if (!excludeSystemModulesForLinks.has(dep) && !skipDep) {
                           depsOfLink.add(dep);
                        }
                     }
                  }
                  json.links[info.componentName] = [...depsOfLink];
                  storeNode(json, info.componentName, { amd: true }, relativePath);
               }
               if (info.hasOwnProperty('libraryName')) {
                  json.packedLibraries[info.libraryName] = info.packedModules;

                  /**
                   * Fill in private modules meta by data of this format:
                   * key: private module packed into library
                   * value: list of libraries that has the private module
                   */
                  info.packedModules.forEach((currentPrivateModule) => {
                     if (!packedPrivateModules.hasOwnProperty(currentPrivateModule)) {
                        packedPrivateModules[currentPrivateModule] = [];
                     }
                     packedPrivateModules[currentPrivateModule].push(info.libraryName);
                  });
               }
               if (info.hasOwnProperty('lessDependencies') && addAdditionalMeta) {
                  const result = new Set();
                  info.lessDependencies.forEach((currentDependency) => {
                     let currentLessDependencies = taskParameters.cache.getDependencies(
                        `${currentDependency}.less`
                     );

                     // css dependency in component is now dynamic(_theme option). We need to use additional search
                     // of less dependencies in corresponding default theme meta to use it to get widened coverage.
                     if (currentLessDependencies.length === 0) {
                        const dependencyParts = currentDependency.split('/');
                        dependencyParts[0] = `${dependencyParts[0]}-default-theme`;
                        currentLessDependencies = taskParameters.cache.getDependencies(
                           `${dependencyParts.join('/')}.less`
                        );
                     }
                     result.add(`css!${currentDependency}`);
                     currentLessDependencies.forEach((currentLessDep) => {
                        result.add(`css!${currentLessDep.replace('.less', '')}`);
                     });
                  });
                  json.lessDependencies[info.componentName] = Array.from(result);
               }
            });

            const markupCache = moduleInfo.cache.getMarkupCache();
            for (const relativePath of Object.keys(markupCache)) {
               const markupObj = markupCache[relativePath];
               if (markupObj) {
                  /**
                   * There is only tmpl and wml meta information needed to be stored into
                   * "links" property of "module-dependencies" meta file. Any other kind of
                   * template files(old deprecated xhtml files, jstpl files) is further useless
                   * in that sort of meta information.
                   */
                  if (markupObj.nodeName.startsWith('tmpl!') || markupObj.nodeName.startsWith('wml!')) {
                     json.links[markupObj.nodeName] = markupObj.dependencies || [];
                  }
                  storeNode(json, markupObj.nodeName, { amd: true }, relativePath);
               }
            }

            const [cssFiles, jstplFiles] = getCssAndJstplFiles(
               taskParameters.cache.getInputPathsByFolder(moduleInfo.outputName)
            );
            for (const relativePath of cssFiles) {
               const prettyRelativePath = modulePathToRequire.getPrettyPath(transliterate(relativePath));
               const nodeName = `css!${prettyRelativePath.replace('.css', '')}`;
               storeNode(json, nodeName, {}, relativePath);
            }
            for (const relativePath of jstplFiles) {
               const prettyPath = modulePathToRequire.getPrettyPath(transliterate(relativePath));
               const nodeName = `text!${prettyPath}`;
               storeNode(json, nodeName, {}, relativePath);
            }

            // Add missing module-dependencies meta for files when meta of those
            // can be received only if this file was compiled.
            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const currentMDepsPath = path.join(taskParameters.config.compiled, moduleInfo.outputName, 'module-dependencies.json');
               if (await fs.pathExists(currentMDepsPath)) {
                  const compiledMDeps = await fs.readJson(currentMDepsPath);
                  Object.keys(compiledMDeps.links).forEach((currentNode) => {
                     /**
                      * add info from compiled meta if
                      * 1) it doesn't exist yet
                      * 2) it's empty
                      * 3) current node is a packed library. In case of compiled sources usage
                      * info about new dependencies list(after it's packed) can be extracted
                      * from compiled module-dependencies meta only.
                      */
                     if (
                        !json.links.hasOwnProperty(currentNode) ||
                        json.links[currentNode].length === 0 ||
                        compiledMDeps.packedLibraries.hasOwnProperty(currentNode)
                     ) {
                        json.links[currentNode] = compiledMDeps.links[currentNode];
                     }
                  });
                  Object.keys(compiledMDeps.nodes).forEach((currentNode) => {
                     if (!json.nodes.hasOwnProperty(currentNode)) {
                        json.nodes[currentNode] = compiledMDeps.nodes[currentNode];
                     }
                     if (compiledMDeps.packedLibraries.hasOwnProperty(currentNode)) {
                        json.packedLibraries[currentNode] = compiledMDeps.packedLibraries[currentNode];
                        moduleInfo.cache.storeComponentParameters(`${currentNode}.ts`, {
                           packedModules: compiledMDeps.packedLibraries[currentNode],
                           componentDep: compiledMDeps.links[currentNode]
                        });
                     }
                  });
               }
            }

            /**
             * сохраняем мета-данные по module-dependencies по требованию.
             */
            if (taskParameters.config.dependenciesGraph) {
               const jsonFile = new Vinyl({
                  path: 'module-dependencies.json',
                  contents: Buffer.from(JSON.stringify(helpers.sortObject(json), null, 2)),
                  moduleInfo
               });
               this.push(jsonFile);
            }

            taskParameters.cache.storeLocalModuleDependencies(json);

            // don't check for libraries interceptions in excluded modules
            if (!INTERCEPT_IGNORE.includes(moduleInfo.name)) {
               /**
                * Check libraries for interceptions between private modules.
                * current private module should be packed only in 1 library,
                * otherwise it should be declared as public dependency and be loaded as single
                * dependency in all dependent libraries
                */
               Object.keys(packedPrivateModules)
                  .filter(currentKey => packedPrivateModules[currentKey].length > 1)
                  .forEach((currentDuplicatedKey) => {
                     const message = `Module ${currentDuplicatedKey} was packed into several libraries:` +
                        `"${packedPrivateModules[currentDuplicatedKey].join('","')}"`;

                     /**
                      * For now, log interceptions with information level. First of all,
                      * we should assess the scale of a problem in common projects.
                      */
                     logger.warning({
                        message,
                        moduleInfo
                     });
                  });
            }
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('presentation service meta', startTime);
      }
   );
};
