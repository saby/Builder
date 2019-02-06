/**
 * @author Бегунов Ал. В.
 */

'use strict';

const transliterate = require('../../../lib/transliterate'),
   path = require('path'),
   BaseModuleInfo = require('../../common/classes/base-module-info');

/**
 * Класс для работы с модулями проекта. Накапливает данные о модулях, которые плохо ложатся на кеш
 */
class ModuleInfo extends BaseModuleInfo {
   constructor(moduleName, moduleResponsible, modulePath, commonOutputPath, required) {
      super(moduleName, moduleResponsible, modulePath, required);
      this.output = path.join(commonOutputPath, transliterate(path.basename(modulePath)));

      // объект для записи contents.json
      // availableLanguage, defaultLanguage добавляются только при локализации
      const runtimeModuleInfo = {};
      if (this.folderName !== this.runtimeModuleName) {
         runtimeModuleInfo.name = this.folderName;
      }
      this.contents = {
         htmlNames: {},
         modules: {
            [this.runtimeModuleName]: runtimeModuleInfo
         }
      };

      // объект для записи static_templates.json
      // соответствие запроса html физическиому расположению файла
      this.staticTemplates = {};

      // объект для записи navigation-modules.json
      this.navigationModules = [];
   }
}

module.exports = ModuleInfo;
