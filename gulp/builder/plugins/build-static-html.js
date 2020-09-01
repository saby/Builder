/* eslint-disable no-invalid-this */

/**
 * Плагин для генерации статических html по *.js файлам.
 * Способ считается устаревшим, но пока поддерживаем.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   path = require('path'),
   pMap = require('p-map');
const transliterate = require('../../../lib/transliterate'),
   generateStaticHtmlForJs = require('../../../lib/generate-static-html-for-js'),
   logger = require('../../../lib/logger').logger();

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {Map} modulesMap имя папки модуля: полный путь до модуля
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo, modulesMap) {
   return through.obj(
      function onTransform(file, encoding, callback) {
         callback(null, file);
      },
      async function onFlush(callback) {
         const startTime = Date.now();
         try {
            const configForReplaceInHTML = {
               urlServicePath: taskParameters.config.urlServicePath,
               urlDefaultServicePath: taskParameters.config.urlDefaultServicePath,
               wsPath: taskParameters.config.resourcesUrl ? 'resources/WS.Core/' : 'WS.Core'
            };
            const needReplacePath = !taskParameters.config.multiService;
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            const results = await pMap(
               Object.keys(componentsInfo),
               async(filePath) => {
                  try {
                     const result = await generateStaticHtmlForJs(
                        filePath,
                        componentsInfo[filePath],
                        moduleInfo,
                        configForReplaceInHTML,
                        modulesMap,
                        needReplacePath
                     );
                     if (result) {
                        result.source = filePath;
                     }
                     return result;
                  } catch (error) {
                     logger.error({
                        message: 'Ошибка при генерации статической html для JS',
                        filePath,
                        error,
                        moduleInfo
                     });
                  }
                  return null;
               },
               {
                  concurrency: 20
               }
            );
            for (const result of results) {
               if (result) {
                  const folderName = transliterate(moduleInfo.folderName);
                  const htmlPath = path.join(folderName, result.outFileName);
                  if (moduleInfo.staticTemplates.hasOwnProperty(result.outFileName)) {
                     moduleInfo.staticTemplates[result.outFileName].push(htmlPath);
                  } else {
                     moduleInfo.staticTemplates[result.outFileName] = [htmlPath];
                  }
                  if (result.hasOwnProperty('urls') && result.urls && result.urls instanceof Array) {
                     for (const url of result.urls) {
                        if (moduleInfo.staticTemplates.hasOwnProperty(url)) {
                           moduleInfo.staticTemplates[url].push(htmlPath);
                        } else {
                           moduleInfo.staticTemplates[url] = [htmlPath];
                        }
                     }
                  }
                  const outputPath = path.join(moduleInfo.output, result.outFileName);
                  taskParameters.cache.addOutputFile(result.source, outputPath, moduleInfo);
                  this.push(
                     new Vinyl({
                        base: moduleInfo.output,
                        path: outputPath,
                        contents: Buffer.from(result.text),
                        pushToServer: taskParameters.config.staticServer
                     })
                  );
               }
            }
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         callback();
         taskParameters.storePluginTime('build static html', startTime);
      }
   );
};
