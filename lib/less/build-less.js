'use strict';
const
   path = require('path'),
   helpers = require('../helpers'),
   builderConstants = require('../builder-constants'),
   { processLessFile } = require('./helpers');

const defaultTheme = 'online';
const themesForModules = new Map([
   ['CloudControl', 'cloud'],
   ['Presto', 'presto'],
   ['Retail', 'carry'],
   ['Genie', 'genie']
]);
const themesPaths = {
   'genie': {
      moduleName: 'Genie',
      path: 'Genie/themes/genie',
      name: 'genie'
   },
   'online': {
      moduleName: 'SBIS3.CONTROLS',
      path: 'SBIS3.CONTROLS/themes/online',
      name: 'online'
   },
   'carry': {
      moduleName: 'Retail-theme',
      path: 'Retail-theme/oldThemes/carry',
      name: 'carry'
   },
   'presto': {
      moduleName: 'Retail-theme',
      path: 'Retail-theme/oldThemes/presto',
      name: 'presto'
   }
};

/**
 @workaround ресолвим текущую тему по названию модуля или папке в темах
 */
function resolveThemeName(filePath, modulePath) {
   const relativePath = filePath.replace(modulePath, '');
   for (const themeName of builderConstants.oldThemes) {
      if (relativePath.includes(`/themes/${themeName}/`)) {
         return themeName;
      }
   }
   const moduleName = path.basename(modulePath);
   if (themesForModules.has(moduleName)) {
      return themesForModules.get(moduleName);
   }
   return defaultTheme;
}

async function buildLess(
   filePath,
   text,
   modulePath,
   autoprefixerOptions,
   gulpModulesInfo
) {
   const startTime = Date.now();
   const prettyFilePath = helpers.prettifyPath(filePath);
   const prettyModulePath = helpers.prettifyPath(modulePath);
   const themeName = resolveThemeName(prettyFilePath, prettyModulePath);

   try {
      const defaultLessResult = await processLessFile(
         text,
         prettyFilePath,
         themesPaths[themeName],
         gulpModulesInfo,
         autoprefixerOptions
      );
      if (defaultLessResult.error) {
         return Object.assign(defaultLessResult, { passedTime: Date.now() - startTime });
      }
      return {
         compiled: defaultLessResult,
         passedTime: Date.now() - startTime
      };
   } catch (error) {
      return {
         error: error.message,
         passedTime: Date.now() - startTime
      };
   }
}

module.exports = {
   resolveThemeName,
   buildLess
};
