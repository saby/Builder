/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @author Kolbeshin F.A.
 */

'use strict';
const path = require('path'),
   fs = require('fs-extra'),
   assert = require('assert');

const logger = require('../../../lib/logger').logger();

/**
 * prepares json-generator-cache to ve used further in generateJson task.
 * Could be useful to get corresponding result of a build rapidly faster than
 * the one without any prepared json generator cache
 * @param root
 * @param currentCachePath
 * @param additionalCachePath
 * @returns {Promise<void>}
 */
async function prepareJsonGeneratorCache(root, currentCachePath, additionalCachePath) {
   const generatorCachePath = path.join(currentCachePath, 'json-generator-cache.json');
   if (!(await fs.pathExists(generatorCachePath))) {
      const jsonGeneratorCache = await fs.readJson(path.join(additionalCachePath, 'json-generator-cache.json'));
      const formattedJsonGenerator = {};

      // normalize path according to a local root path. TODO remove it after json-generator-cache has relative paths
      // https://online.sbis.ru/opendoc.html?guid=46a18202-2dc4-47fe-97f7-a1949cf49ffe
      Object.keys(jsonGeneratorCache).forEach((currentPath) => {
         const relativePath = currentPath.replace(/.+?temp-modules(\/|\\)/, '');
         const normalizedPath = path.join(root, relativePath);
         formattedJsonGenerator[normalizedPath] = jsonGeneratorCache[currentPath];
         delete jsonGeneratorCache[currentPath];
      });
      await fs.outputJson(generatorCachePath, formattedJsonGenerator);
   }
}

/**
 * Генерация задачи генерации json описания компонентов для локализации
 * @param {TaskParameters} taskParameters параметры для задач
 * @return {function} функция-задача для gulp
 */
function generateTaskForGenerateJson(taskParameters) {
   if (!taskParameters.needGenerateJson) {
      return function skipGenerateJson(done) {
         done();
      };
   }
   return async function generateJson() {
      const startTime = Date.now();
      try {
         const folders = [];
         for (const module of taskParameters.config.modules) {
            folders.push(module.path);
         }

         // если локализация не нужна, то и ругаться, что json-generator нет, не нужно.
         // eslint-disable-next-line global-require
         const runJsonGenerator = require('../../../lib/i18n/run-json-generator');
         if (await fs.pathExists(path.join(taskParameters.config.additionalCachePath, 'json-generator-cache.json'))) {
            await prepareJsonGeneratorCache(
               path.join(taskParameters.config.cachePath, 'temp-modules'),
               taskParameters.config.cachePath,
               taskParameters.config.additionalCachePath
            );
         }
         const resultJsonGenerator = await runJsonGenerator(folders, taskParameters.config.cachePath);
         for (const error of resultJsonGenerator.errors) {
            logger.warning({
               message: 'Ошибка при разборе JSDoc комментариев',
               filePath: error.filePath,
               error: error.error
            });
         }

         // если components-properties поменялись, то нужно сбросить кеш для верстки
         let isComponentsPropertiesChanged = false;
         const filePath = path.join(taskParameters.config.cachePath, 'components-properties.json');
         if (await fs.pathExists(filePath)) {
            let oldIndex = {};
            try {
               oldIndex = await fs.readJSON(filePath);
            } catch (err) {
               logger.warning({
                  message: 'Не удалось прочитать файл кеша',
                  filePath,
                  error: err
               });
            }

            try {
               assert.deepStrictEqual(oldIndex, resultJsonGenerator.index);
            } catch (error) {
               isComponentsPropertiesChanged = true;
            }
         } else {
            isComponentsPropertiesChanged = true;
         }
         if (isComponentsPropertiesChanged) {
            logger.info('Template files cache will be erased if it exists');
            taskParameters.cache.setDropCacheForMarkup();
            await fs.writeJSON(filePath, resultJsonGenerator.index, { spaces: 1 });
         }
      } catch (error) {
         logger.error({
            message: "Builder's error in 'generateJson' task",
            error
         });
      }
      taskParameters.storeTaskTime('json-generator', startTime);
   };
}

module.exports = generateTaskForGenerateJson;
