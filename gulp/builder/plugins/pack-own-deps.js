/**
 * Плагин для паковки собственных зависимостей.
 * В js компоненты добавляется код собранных tmpl и xhtml из зависимостей.
 * Сильно влияет на плагин minify-js
 * @author Бегунов Ал. В.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   // js файлы можно паковать только после сборки xhtml, tmpl и wml файлов.
   // поэтому переместим обработку в самый конец
   const jsFiles = [];
   return through.obj(
      function onTransform(file, encoding, callback) {
         if (file.extname !== '.js') {
            callback(null, file);
         } else {
            jsFiles.push(file);
            callback();
         }
      },

      /* @this Stream */
      function onFlush(callback) {
         try {
            const componentsInfo = taskParameters.cache.getComponentsInfo(moduleInfo.name);
            const markupCache = taskParameters.cache.getMarkupCache(moduleInfo.name);
            const nodenameToMarkup = new Map();
            for (const filePath of Object.keys(markupCache)) {
               const markupObj = markupCache[filePath];
               if (markupObj) {
                  nodenameToMarkup.set(markupObj.nodeName, {
                     text: markupObj.text,
                     versioned: markupObj.versioned,
                     filePath
                  });
               }
            }
            const getFullPathInSource = (dep) => {
               const moduleNameOutput = path.basename(moduleInfo.output);
               let relativeFileName = '';
               if (dep.startsWith('html!')) {
                  relativeFileName = `${relativeFileName.replace('html!', '')}.xhtml`;
               } else if (dep.startsWith('tmpl!')) {
                  relativeFileName = `${relativeFileName.replace('tmpl!', '')}.tmpl`;
               } else {
                  relativeFileName = `${relativeFileName.replace('wml!', '')}.wml`;
               }
               if (relativeFileName.startsWith(moduleNameOutput)) {
                  const relativeFileNameWoModule = relativeFileName
                     .split('/')
                     .slice(1)
                     .join('/');
                  return path.join(moduleInfo.path, relativeFileNameWoModule);
               }
               return '';
            };

            for (const jsFile of jsFiles) {
               // важно сохранить в зависимости для js все файлы, которые должны приводить к пересборке файла
               const filesDepsForCache = new Set();
               const ownDeps = [];
               const prettyFilePath = helpers.prettifyPath(jsFile.history[0]);
               if (componentsInfo.hasOwnProperty(prettyFilePath)) {
                  const componentInfo = componentsInfo[prettyFilePath];
                  if (componentInfo.componentName && componentInfo.componentDep) {
                     for (const dep of componentInfo.componentDep) {
                        if (dep.startsWith('html!') || dep.startsWith('tmpl!') || dep.startsWith('wml!')) {
                           ownDeps.push(dep);
                           const fullPath = getFullPathInSource(dep);
                           if (fullPath) {
                              filesDepsForCache.add(fullPath);
                           }
                        }
                     }
                  }
               }
               if (ownDeps.length > 0) {
                  const modulepackContent = [];
                  let hasVersionedMarkup = false;
                  for (const dep of ownDeps) {
                     if (nodenameToMarkup.has(dep)) {
                        const markupObj = nodenameToMarkup.get(dep);
                        filesDepsForCache.add(markupObj.filePath);
                        modulepackContent.push(markupObj.text);
                        if (markupObj.versioned) {
                           hasVersionedMarkup = true;
                        }
                     }
                  }
                  if (modulepackContent.length > 0) {
                     const jsContent = jsFile.library ? jsFile.modulepack.toString() : jsFile.contents.toString();
                     modulepackContent.push(jsContent);
                     jsFile.modulepack = modulepackContent.join('\n');
                  }

                  /**
                   * добавляем в кэш версионирования информацию о компонентах, в которые
                   * были запакованы версионированные шаблоны
                   */
                  if (hasVersionedMarkup) {
                     jsFile.versioned = true;
                  }
               }
               if (filesDepsForCache.size > 0) {
                  taskParameters.cache.addDependencies(prettyFilePath, [...filesDepsForCache]);
               }
               this.push(jsFile);
            }
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback(null);
      }
   );
};
