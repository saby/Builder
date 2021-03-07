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
   modulePathToRequire = require('../../../lib/modulepath-to-require');

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
      jsonFiles = [],
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
      if (filePath.endsWith('.json')) {
         jsonFiles.push(filePath);
      }
   });
   return [cssFiles, jstplFiles, jsonFiles];
}

function getNodePath(prettyPath, ext) {
   let result = prettyPath;

   // An AMD-module formatted json generates, so there should be corresponding path for it
   if (ext === '.json') {
      return prettyPath.replace(ext, `${ext}.min.js`);
   }

   if (!prettyPath.endsWith(`.min${ext}`)) {
      result = prettyPath.replace(ext, `.min${ext}`);
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
   const { resourcesUrl } = taskParameters.config;
   const addAdditionalMeta = taskParameters.config.branchTests || taskParameters.config.builderTests;
   const storeNode = (mDeps, nodeName, objectToStore, filePath) => {
      const ext = path.extname(filePath);
      const relativePath = path.relative(path.dirname(moduleInfo.path), filePath);
      const rebasedRelativePath = resourcesUrl ? path.join('resources', relativePath) : relativePath;
      const prettyPath = helpers.prettifyPath(transliterate(rebasedRelativePath));


      objectToStore.path = getNodePath(prettyPath, ext);
      mDeps.nodes[nodeName] = objectToStore;

      /**
       * WS.Core interface module only has actual requirejs substitutions.
       * Store all of these for branch tests.
       */
      if (moduleInfo.name === 'WS.Core' && addAdditionalMeta) {
         mDeps.requireJsSubstitutions[`${nodeName}`] = helpers.prettifyPath(relativePath);
      }
   };
   const addNodesWithExtension = (mDeps, files, plugin, extensionToReplace) => {
      for (const filePath of files) {
         const relativePath = path.relative(path.dirname(moduleInfo.path), filePath);
         const prettyPath = modulePathToRequire.getPrettyPath(
            helpers.prettifyPath(transliterate(relativePath))
         );
         const nodeName = `${plugin}!${extensionToReplace ? prettyPath.replace(extensionToReplace, '') : prettyPath}`;
         storeNode(mDeps, nodeName, {}, filePath);
      }
   };
   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         callback(null, file);
         taskParameters.storePluginTime('presentation service meta', startTime);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const sourceRoot = helpers.unixifyPath(
               path.join(taskParameters.config.cachePath, 'temp-modules')
            );
            const json = {
               links: {},
               nodes: {},
               packedLibraries: {}
            };
            if (addAdditionalMeta) {
               json.lessDependencies = {};
               json.requireJsSubstitutions = {};
            }
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            Object.keys(componentsInfo).forEach((filePath) => {
               const info = componentsInfo[filePath];
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
                  storeNode(json, info.componentName, { amd: true }, filePath);
               }
               if (info.hasOwnProperty('libraryName')) {
                  json.packedLibraries[info.libraryName] = info.packedModules;
               }
               if (info.hasOwnProperty('lessDependencies') && addAdditionalMeta) {
                  const result = new Set();
                  info.lessDependencies.forEach((currentDependency) => {
                     const currentLessDependencies = taskParameters.cache.getDependencies(
                        `${path.join(sourceRoot, currentDependency)}.less`
                     );
                     result.add(`css!${currentDependency}`);
                     currentLessDependencies.forEach((currentLessDep) => {
                        result.add(`css!${helpers.removeLeadingSlashes(
                           currentLessDep
                              .replace(sourceRoot, '')
                              .replace('.less', '')
                        )}`);
                     });
                  });
                  json.lessDependencies[info.componentName] = Array.from(result);
               }
            });

            const markupCache = moduleInfo.cache.getMarkupCache();
            for (const filePath of Object.keys(markupCache)) {
               const markupObj = markupCache[filePath];
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
                  storeNode(json, markupObj.nodeName, { amd: true }, filePath);
               }
            }

            const [cssFiles, jstplFiles, jsonFiles] = getCssAndJstplFiles(
               taskParameters.cache.getInputPathsByFolder(moduleInfo.path)
            );
            addNodesWithExtension(json, cssFiles, 'css', '.css');
            addNodesWithExtension(json, jstplFiles, 'text');
            addNodesWithExtension(json, jsonFiles, 'json', '.json');

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
