/**
 * Плагин для парсинга js компонентов и получения из них всей необходимой для сборки информации.
 * Больше js компоненты парсится не должны нигде.
 * Результат кешируется.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   { componentCantBeParsed } = require('../../../lib/helpers'),
   execInPool = require('../../common/exec-in-pool');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   return through.obj(
      async function onTransform(file, encoding, callback) {
         if (file.cached) {
            callback(null, file);
            return;
         }

         if (componentCantBeParsed(file)) {
            callback(null, file);
            return;
         }

         const [error, componentInfo] = await execInPool(
            taskParameters.pool,
            'parseJsComponent',
            [
               file.contents.toString(),
               taskParameters.config.lessCoverage || taskParameters.config.builderTests
            ],
            file.history[0],
            moduleInfo
         );
         if (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Ошибка при обработке JS компонента',
               filePath: file.history[0],
               error,
               moduleInfo
            });
         }
         if (componentInfo.patchedText) {
            file.contents = Buffer.from(componentInfo.patchedText);
         }
         taskParameters.storePluginTime('parseJsComponent', componentInfo.passedTime, true);
         delete componentInfo.passedTime;
         if (!componentInfo) {
            // if current file parse was completed with error, remove file
            // from inputPaths to repeat this error further in next build.
            taskParameters.cache.deleteFailedFromCacheInputs(file.history[0]);
         }
         moduleInfo.cache.storeComponentInfo(file.history[0], componentInfo);
         callback(null, file);
      },
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            const componentsInfo = moduleInfo.cache.getComponentsInfo();
            Object.keys(componentsInfo).forEach((filePath) => {
               const info = componentsInfo[filePath];
               if (info.hasOwnProperty('isNavigation') && info.isNavigation) {
                  moduleInfo.navigationModules.push(info.componentName);
               }
            });
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         taskParameters.storePluginTime('parseJsComponent', startTime);
         callback();
      }
   );
};
