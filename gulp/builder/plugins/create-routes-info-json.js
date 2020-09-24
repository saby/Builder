/**
 * Плагин для создания routes-info.json (информация для работы роутинга)
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   Vinyl = require('vinyl'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers'),
   transliterate = require('../../../lib/transliterate'),
   processingRoutes = require('../../../lib/processing-routes'),
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
         if (!file.path.endsWith('.routes.js')) {
            callback(null, file);
            return;
         }

         const [error, routeInfo] = await execInPool(
            taskParameters.pool,
            'parseRoutes',
            [file.contents.toString()],
            file.history[0],
            moduleInfo
         );
         if (error) {
            taskParameters.cache.markFileAsFailed(file.history[0]);
            logger.error({
               message: 'Ошибка при обработке файла роутинга',
               filePath: file.history[0],
               error,
               moduleInfo
            });
         } else {
            taskParameters.storePluginTime('routes-info', routeInfo.passedTime, true);
            delete routeInfo.passedTime;
            if (!routeInfo) {
               // if current file parse was completed with error, remove file
               // from inputPaths to repeat this error further in next build.
               taskParameters.cache.deleteFailedFromCacheInputs(file.history[0]);
            }
            moduleInfo.cache.storeRouteInfo(file.history[0], routeInfo);
         }
         callback(null, file);
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         try {
            // Всегда сохраняем файл, чтобы не было ошибки при удалении последнего роутинга в модуле.

            // нужно преобразовать абсолютные пути в исходниках в относительные пути в стенде
            const routesInfoBySourceFiles = moduleInfo.cache.getRoutesInfo();
            const resultRoutesInfo = {};
            const { resourcesUrl } = taskParameters.config;
            Object.keys(routesInfoBySourceFiles).forEach((filePath) => {
               const routeInfo = routesInfoBySourceFiles[filePath];
               const relativePath = path.relative(path.dirname(moduleInfo.path), filePath);
               const rebasedRelativePath = resourcesUrl ? path.join('resources', relativePath) : relativePath;
               const relativeResultPath = helpers.prettifyPath(transliterate(rebasedRelativePath));
               resultRoutesInfo[relativeResultPath.replace(/\.ts$/, '.js')] = routeInfo;
            });

            // подготовим routes-info.json
            processingRoutes.prepareToSave(resultRoutesInfo);

            const routesInfoText = JSON.stringify(helpers.sortObject(resultRoutesInfo), null, 2);
            const routesInfoFile = new Vinyl({
               path: 'routes-info.json',
               contents: Buffer.from(routesInfoText),
               moduleInfo
            });
            this.push(routesInfoFile);
         } catch (error) {
            logger.error({
               message: "Ошибка Builder'а",
               error,
               moduleInfo
            });
         }
         taskParameters.storePluginTime('routes-info', startTime);
         callback();
      }
   );
};
