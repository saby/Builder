/**
 * Плагин для удаления из потока Gulp исходников и мета-файлов,
 * которые не должны попасть в конечную директорию. Актуально для
 * Desktop-приложений.
 * @author Колбешин Ф.А.
 */

'use strict';

const through = require('through2');
const { checkSourceNecessityByConfig } = require('../../common/helpers');
const builderMeta = new Set([
   'module-dependencies.json',
   'navigation-modules.json',
   'routes-info.json',
   'static_templates.json'
]);
const helpers = require('../../../lib/helpers');
const path = require('path');
const extensions = new Set([
   '.js',
   '.tmpl',
   '.xhtml',
   '.less',
   '.wml',
   '.json',
   '.jstpl',
   '.css',
   '.es',
   '.ts',
   '.map'
]);
const privateModuleExt = /(\.min)?(\.js|\.wml|\.tmpl)/;

function getModuleNameWithPlugin(currentModule) {
   const prettyFilePath = helpers.unixifyPath(currentModule.path);
   const prettyRoot = helpers.unixifyPath(path.dirname(currentModule.base));
   const prettyRelativePath = helpers.removeLeadingSlashes(prettyFilePath.replace(prettyRoot, ''));
   const currentModuleName = prettyRelativePath.replace(privateModuleExt, '');
   const currentPlugin = currentModule.extname.slice(1, currentModule.extname.length);
   const result = {
      currentRelativePath: prettyRelativePath
   };
   switch (currentPlugin) {
      case 'tmpl':
      case 'wml':
      case 'css':
         result.normalizedModuleName = `${currentPlugin}!${currentModuleName}`;
         break;
      case 'xhtml':
         result.normalizedModuleName = `html!${currentModuleName}`;
         break;
      default:
         result.normalizedModuleName = currentModuleName;
         break;
   }
   return result;
}

/**
 * Объявление плагина
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const buildConfig = taskParameters.config;
   const modulesToCheck = [];
   const currentModuleName = helpers.prettifyPath(moduleInfo.output).split('/').pop();
   let versionedMetaFile, cdnMetaFile, moduleDepsMetaFile;

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         if (file.basename === 'module-dependencies.json') {
            moduleDepsMetaFile = file;
            callback(null);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }

         /**
          * не копируем мета-файлы билдера.
          */
         if (builderMeta.has(file.basename)) {
            if (taskParameters.config.builderTests) {
               callback(null, file);
            } else {
               callback(null);
            }
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }

         /**
          * если файл нестандартного расширения, сразу копируем.
          */
         if (!extensions.has(file.extname)) {
            callback(null, file);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }

         /**
          * contents помодульный нужен всегда, копируем его.
          */
         if (file.basename === 'contents.json') {
            callback(null, file);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }

         if (file.basename === 'versioned_modules.json') {
            versionedMetaFile = file;
            callback(null);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }
         if (file.basename === 'cdn_modules.json') {
            cdnMetaFile = file;
            callback(null);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }
         if (!checkSourceNecessityByConfig(buildConfig, file.extname)) {
            callback(null);
            taskParameters.storePluginTime('copy sources', startTime);
            return;
         }

         const debugMode = !buildConfig.minimize;
         const isMinified = file.basename.endsWith(`.min${file.extname}`);
         switch (file.extname) {
            case '.js':
               /**
                * нужно скопировать .min.original модули, чтобы не записать в кастомный
                * пакет шаблон компонента 2 раза
                */
               if (debugMode || isMinified || file.basename.endsWith('.min.original.js')) {
                  modulesToCheck.push(file);
                  callback(null);
                  taskParameters.storePluginTime('copy sources', startTime);
                  return;
               }
               callback(null);
               taskParameters.storePluginTime('copy sources', startTime);
               return;
            case '.json':
               /**
                * конфиги для кастомной паковки нужно скопировать, чтобы создались кастомные пакеты
                */
               if (debugMode || isMinified || file.basename.endsWith('.package.json')) {
                  callback(null, file);
                  taskParameters.storePluginTime('copy sources', startTime);
                  return;
               }
               callback(null);
               taskParameters.storePluginTime('copy sources', startTime);
               return;
            case '.less':
            case '.ts':
            case '.es':
               callback(null);
               taskParameters.storePluginTime('copy sources', startTime);
               return;

            // templates, .css, .jstpl, typescript sources, less
            default:
               if (debugMode || isMinified) {
                  modulesToCheck.push(file);
               }
               callback(null);
               taskParameters.storePluginTime('copy sources', startTime);
               break;
         }
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         const moduleDeps = taskParameters.cache.getModuleDependencies();
         const currentModulePrivateLibraries = new Set();
         const modulesToRemoveFromMeta = new Map();

         Object.keys(moduleDeps.packedLibraries)
            .filter(currentLibrary => currentLibrary.startsWith(currentModuleName))
            .forEach((currentLibrary) => {
               moduleDeps.packedLibraries[currentLibrary].forEach(
                  currentModule => currentModulePrivateLibraries.add(currentModule)
               );
            });
         modulesToCheck.forEach((currentModule) => {
            const { normalizedModuleName, currentRelativePath } = getModuleNameWithPlugin(currentModule);

            // remove from gulp stream packed into libraries files
            if (currentModulePrivateLibraries.has(normalizedModuleName)) {
               modulesToRemoveFromMeta.set(currentRelativePath, normalizedModuleName);
               taskParameters.cache.removeVersionedModule(currentModule.history[0], moduleInfo.name);
               taskParameters.cache.removeCdnModule(currentModule.history[0], moduleInfo.name);
               taskParameters.storePluginTime('copy sources', startTime);
               return;
            }
            this.push(currentModule);
         });

         // remove private parts of libraries from module-dependencies meta
         currentModulePrivateLibraries.forEach((moduleName) => {
            delete moduleDeps.nodes[moduleName];
         });

         if (moduleDepsMetaFile) {
            moduleDepsMetaFile.contents = Buffer.from(JSON.stringify(moduleDeps));
            if (taskParameters.config.builderTests) {
               this.push(moduleDepsMetaFile);
            }
         }
         if (taskParameters.config.version) {
            // remove private parts of libraries from versioned and cdn meta
            taskParameters.versionedModules[currentModuleName] = taskParameters.versionedModules[currentModuleName]
               .filter(
                  currentPath => !modulesToRemoveFromMeta.has(currentPath)
               );
            taskParameters.cdnModules[currentModuleName] = taskParameters.cdnModules[currentModuleName]
               .filter(
                  currentPath => !modulesToRemoveFromMeta.has(currentPath)
               );
            versionedMetaFile.contents = Buffer.from(JSON.stringify(
               taskParameters.versionedModules[currentModuleName].sort()
            ));
            cdnMetaFile.contents = Buffer.from(JSON.stringify(
               taskParameters.cdnModules[currentModuleName].sort()
            ));
            this.push(versionedMetaFile);
            this.push(cdnMetaFile);
         }

         callback();
         taskParameters.storePluginTime('copy sources', startTime);
      }
   );
};
