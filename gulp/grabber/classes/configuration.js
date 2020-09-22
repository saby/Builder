/* eslint-disable no-sync */

/**
 * @author Kolbeshin F.A.
 */

'use strict';

const ConfigurationReader = require('../../common/configuration-reader'),
   ModuleInfo = require('../../common/classes/base-module-info');

/**
 * Класс с данными о конфигурации сборки
 */
class GrabberConfiguration {
   constructor() {
      // путь до файла конфигурации
      this.configFile = '';

      // не приукрашенные данные конфигурации. используются в changes-store для решения о сбросе кеша
      this.rawConfig = {};

      // список объектов, содержащий в себе полную информацию о модулях.
      this.modules = [];

      // путь до папки с кешем
      this.cachePath = '';

      // builder grabber task requires initialized core
      this.initCore = true;
   }

   loadSync(argv) {
      this.configFile = ConfigurationReader.getProcessParameters(argv).config;
      this.rawConfig = ConfigurationReader.readConfigFileSync(this.configFile, process.cwd());

      const startErrorMessage = `Файл конфигурации ${this.configFile} не корректен.`;

      this.cachePath = this.rawConfig.cache;
      if (!this.cachePath) {
         throw new Error(`${startErrorMessage} Не задан обязательный параметр cache`);
      }

      for (const module of this.rawConfig.modules) {
         const moduleInfo = new ModuleInfo(module);
         moduleInfo.symlinkInputPathToAvoidProblems(this.cachePath, false);
         this.modules.push(moduleInfo);
      }

      this.outputPath = this.rawConfig.output;
      if (!this.outputPath) {
         throw new Error(`${startErrorMessage} Не задан обязательный параметр output`);
      }

      if (!this.outputPath.endsWith('.json')) {
         throw new Error(`${startErrorMessage} Параметр output должен быть json-файлом.`);
      }

      /**
       * При работе сбора фраз локализации нам в обязательном порядке надо инициализировать ядро, поскольку
       * для работы данной таски в обязательном порядке необходим модуль Core/markup/ParserUtilities
       * @type {boolean}
       */
      this.needTemplates = true;

      if (this.rawConfig.hasOwnProperty('builderTests')) {
         this.builderTests = this.rawConfig.builderTests;
      }
   }
}

module.exports = GrabberConfiguration;
