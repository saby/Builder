/**
 * Плагин для паковки собственных зависимостей.
 * В js компоненты добавляется код собранных tmpl и xhtml из зависимостей.
 * Сильно влияет на плагин minify-js
 * @author Kolbeshin F.A.
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
         if (file.extname !== '.js' || file.library) {
            callback(null, file);
         } else {
            jsFiles.push(file);
            callback();
         }
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            const markupCache = moduleInfo.cache.getMarkupCache();
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
               const prettyRelativePath = helpers.unixifyPath(path.join(moduleInfo.name, jsFile.relative));
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
                  let hasCdnLinkedMarkup = false;
                  for (const dep of ownDeps) {
                     if (nodenameToMarkup.has(dep)) {
                        const markupObj = nodenameToMarkup.get(dep);
                        filesDepsForCache.add(markupObj.filePath);
                        modulepackContent.push(markupObj.text);
                        if (markupObj.versioned) {
                           hasVersionedMarkup = true;
                        }
                        if (markupObj.cdnLinked) {
                           hasCdnLinkedMarkup = true;
                        }
                     }
                  }
                  if (modulepackContent.length > 0) {
                     modulepackContent.push(jsFile.contents.toString());
                     jsFile.modulepack = modulepackContent.join('\n');
                  }

                  /**
                   * добавляем в кэш версионирования информацию о компонентах, в которые
                   * были запакованы версионированные шаблоны
                   * добавляем в кэш cdn ссылок информацию о компонентах, в которые были
                   * запакованы шаблоны с ссылками на cdn
                   */
                  if (hasVersionedMarkup) {
                     jsFile.versioned = true;
                  }
                  if (hasCdnLinkedMarkup) {
                     jsFile.cdnLinked = true;
                  }
               }
               if (filesDepsForCache.size > 0) {
                  taskParameters.cache.addDependencies(
                     path.dirname(moduleInfo.path),
                     prettyRelativePath,
                     [...filesDepsForCache]
                  );
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
         taskParameters.storePluginTime('own dependencies packer', startTime);
      }
   );
};
