/**
 * Сохраняем в корень каталога основные мета-файлы сборщика, используемые в дальнейшем
 * в онлайн-продуктах:
 * 1) contents - основная мета-информация, необходимая для настройки require и функционирования
 * приложения.
 * 2) module-dependencies - используется плагином SBIS Dependency Tree.
 * Остальные файлы(bundles.json и bundlesRoute.json) будут сохранены в соответствующей таске по
 * сохранению результатов кастомной паковки.
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const path = require('path');
const logger = require('../../../lib/logger').logger();
const generateJoinedThemes = require('../../../lib/save-themes');
const pMap = require('p-map');

/**
 * Reads all of "router.json" meta from interface modules
 * and saves them into joined meta in application root
 * @param modules - list of modules to be processed
 * @returns {Promise<{}>}
 */
async function readJoinAndSaveRouterJson(modules) {
   const routerMeta = {};
   await pMap(
      modules,
      async(moduleInfo) => {
         const currentRouterPath = path.join(moduleInfo.output, 'router.json');
         try {
            if (await fs.pathExists(currentRouterPath)) {
               const currentRouterMeta = await fs.readJson(currentRouterPath);
               Object.keys(currentRouterMeta).forEach((currentRouterKey) => {
                  routerMeta[currentRouterKey] = currentRouterMeta[currentRouterKey];
               });
            }
         } catch (error) {
            logger.error({
               message: 'Error occurred while reading "router.json" meta for current interface module',
               error,
               moduleInfo
            });
         }
      }
   );
   return routerMeta;
}


/**
 * Генерация задачи сохранения в корень каталога основных мета-файлов сборщика
 * @param{Object} taskParameters
 * @returns {*}
 */
module.exports = function generateTaskForSaveJoinedMeta(taskParameters) {
   const root = taskParameters.config.rawConfig.output;
   const fileSuffix = taskParameters.config.isReleaseMode ? '.min' : null;
   const isThemeForReleaseOnly = !taskParameters.config.sources && taskParameters.config.isReleaseMode;
   if (!taskParameters.config.joinedMeta) {
      return async function saveOnlyThemesMeta() {
         const resultThemesMeta = {};
         const { themes } = taskParameters.cache.getThemesMeta();
         Object.keys(themes).forEach((currentTheme) => {
            if (!isThemeForReleaseOnly) {
               resultThemesMeta[`themes/${currentTheme}.css`] = themes[currentTheme].map(file => `${file}.css`);
            }
            if (typeof fileSuffix === 'string') {
               resultThemesMeta[`themes/${currentTheme}${fileSuffix}.css`] = themes[currentTheme].map(file => `${file}${fileSuffix}.css`);
            }
         });
         await fs.outputJson(path.join(root, 'themes.json'), resultThemesMeta);
      };
   }

   // save joined meta for non-jinnee application
   return async function saveJoinedMeta() {
      const startTime = Date.now();
      const themesMeta = taskParameters.cache.getThemesMeta();
      const resourceRoot = `${taskParameters.config.applicationForRebase}${taskParameters.config.resourcesUrl ? 'resources/' : ''}`;
      await generateJoinedThemes(root, isThemeForReleaseOnly, fileSuffix, themesMeta.themes, resourceRoot);
      if (taskParameters.config.dependenciesGraph) {
         const moduleDeps = taskParameters.cache.getModuleDependencies();
         await fs.writeJson(path.join(root, 'module-dependencies.json'), moduleDeps);
         if (taskParameters.config.isReleaseMode) {
            await fs.writeJson(path.join(root, 'module-dependencies.min.json'), moduleDeps);
         }
      }
      await fs.writeFile(path.join(root, 'bundles.js'), 'bundles={};');
      if (taskParameters.config.commonContents) {
         await fs.writeJson(
            path.join(
               root,
               'contents.json'
            ),
            taskParameters.config.commonContents
         );
         await fs.writeFile(
            path.join(
               root,
               'contents.js'
            ),
            `contents=${JSON.stringify(taskParameters.config.commonContents)};`
         );
         if (taskParameters.config.isReleaseMode) {
            await fs.writeFile(
               path.join(
                  root,
                  'contents.min.js'
               ),
               `contents=${JSON.stringify(taskParameters.config.commonContents)};`
            );
         }
      }

      const routerMeta = await readJoinAndSaveRouterJson(taskParameters.config.modules);
      const routerContent = `define('router', [], function(){ return ${JSON.stringify(routerMeta)}; })`;
      await fs.writeFile(path.join(root, 'router.js'), routerContent);
      if (taskParameters.config.isReleaseMode) {
         await fs.writeFile(path.join(root, 'router.min.js'), routerContent);
      }
      taskParameters.storeTaskTime('save joined presentation service meta', startTime);
   };
};
