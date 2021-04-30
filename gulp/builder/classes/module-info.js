/**
 * @author Kolbeshin F.A.
 */

'use strict';

const transliterate = require('../../../lib/transliterate'),
   path = require('path'),
   BaseModuleInfo = require('../../common/classes/base-module-info');

/**
 * Класс для работы с модулями проекта. Накапливает данные о модулях, которые плохо ложатся на кеш
 */
class ModuleInfo extends BaseModuleInfo {
   constructor(baseModuleInfo, commonOutputPath, staticServer) {
      super(baseModuleInfo);
      this.outputName = transliterate(path.basename(baseModuleInfo.path));
      this.output = path.join(commonOutputPath, this.outputName);
      this.outputRoot = path.dirname(this.output).replace(/\\/g, '/');

      // объект для записи contents.json
      // availableLanguage, defaultLanguage добавляются только при локализации
      const runtimeModuleInfo = {};
      if (this.folderName !== this.runtimeModuleName) {
         runtimeModuleInfo.name = this.folderName;
      }
      if (staticServer && baseModuleInfo.name === 'HotReload') {
         runtimeModuleInfo.staticServer = staticServer;
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
