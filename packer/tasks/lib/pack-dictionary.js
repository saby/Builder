'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   helpers = require('../../../lib/helpers');

/**
 * Возращает имя интерфейсного модуля.
 * @param {String} pathModule - путь до модуля.
 * @returns {String} - имя интерфейсного модуля.
 */

function getNameModule(pathModule, applicationRoot) {
   const pathWithoutRoot = pathModule.replace(applicationRoot, '');

   return helpers.removeLeadingSlashes(pathWithoutRoot).split('/').shift();
}

/**
 * Returns AMD-formatted dictionary path
 * @param {String} applicationRoot - путь до сервиса.
 * @param {String} moduleName - Interface module name.
 * @param {String} locale - current locale
 * @param {String} region - current region
 * @returns {String} - путь до словаря.
 */
function getAmdDictionaryPath(applicationRoot, moduleName, locale, region) {
   const localePath = path.join(applicationRoot, moduleName, 'lang', locale);
   if (fs.existsSync(path.join(localePath, `${locale}-${region}.json.js`))) {
      return path.normalize(path.join(localePath, `${locale}-${region}.json.js`));
   }
   return path.normalize(path.join(localePath, `${locale}.json.js`));
}

/**
 * Проверяет если уже в пакете словарь для данного интерфейсного модуля.
 * @param {String} name - имя интерфейсного модуля.
 * @param {String} lang - обробатываем язык.
 * @param {Boolean} isPackedDict - список словарей которые уже довлены в пакет.
 * @returns {boolean} true - если словарь надо пакетировать, false - если словарь не надо пакетировать.
 */
function needPushDict(moduleName, lang, isPackedDict) {
   return !(isPackedDict[moduleName] && isPackedDict[moduleName][lang]);
}

/**
 * Возращает имя модуля-словаря.
 * @param {String} name - имя интерфейсного модуля.
 * @param {String} lang - обробатываем язык.
 * @returns {string} - имя модуля словаря.
 */
function getNameDict(name, lang) {
   return `${name}/lang/${lang}/${lang}`;
}

/**
 * Создаёт js-модуль, содержащий сам словарь!.
 * @param {Object} modulejs - мета данные js-ого модуля словаря.
 * @returns {{amd: boolean, encode: boolean, fullName: string, fullPath: string, module: string, plugin: string}}
 *          - мета данные json модуля.
 */
function createJsonJsModule(moduleName, fullPath, lang) {
   const moduleFullPath = helpers.unixifyPath(fullPath.replace(/\.js$/, '.json.js'));
   const jsonModuleName = `${getNameDict(moduleName, lang)}.json`;
   return {
      amd: true,
      encode: false,
      fullName: jsonModuleName,
      fullPath: moduleFullPath,
      module: jsonModuleName,
      plugin: 'js'
   };
}

/**
 * Returns list of dictionaries for current modules list.
 * @param {Array} modules - list of modules for current packages.
 * @param {String} applicationRoot - absolute path to current project's root.
 * @param {Array} availableLanguage - list of available languages for current project build.
 * @returns {Object}
 */
function packDictClassic(modules, applicationRoot, availableLanguage) {
   const dictPack = {};
   const isPackedDict = {};

   try {
      availableLanguage.forEach((lang) => {
         dictPack[lang] = [];
      });

      modules.filter(module => !!module.fullPath).forEach((module) => {
         const moduleName = getNameModule(module.fullPath, applicationRoot);
         Object.keys(dictPack).forEach((lang) => {
            const [currentLocale, currentRegion] = lang.split('-');
            const fullPath = getAmdDictionaryPath(applicationRoot, moduleName, currentLocale, currentRegion);
            if (needPushDict(moduleName, lang, isPackedDict)) {
               const dictTextModule = createJsonJsModule(moduleName, fullPath, lang);
               dictPack[lang].push(dictTextModule);

               if (!isPackedDict[moduleName]) {
                  isPackedDict[moduleName] = {};
               }
               isPackedDict[moduleName][lang] = true;
            }
         });
      });
   } catch (error) {
      logger.error({ error });
   }
   return dictPack;
}

/**
 * Удаляет из пакета все модули локализации.
 * @param {Array} modules - список js-модулей пакета.
 * @returns {Array}
 */
function deleteOldModulesLocalization(modules) {
   return modules.filter((module) => {
      if (module.plugin && module.plugin === 'i18n') {
         return false;
      }
      return !(module.fullName && /\/lang\/[\w-]+\/[\w-]+/.test(module.fullName));
   });
}

module.exports = {
   packerDictionary: packDictClassic,
   deleteModulesLocalization: deleteOldModulesLocalization
};
