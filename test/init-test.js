/* eslint-disable global-require, no-sync */
'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   chai = require('chai'),
   chaiAsPromised = require('chai-as-promised');

// TODO: разобраться почему объявление gulp после WS не работает
require('gulp');

// логгер - глобальный, должен быть определён до инициализации WS
require('../lib/logger').setGulpLogger();

chai.use(chaiAsPromised);
chai.should();

function copyWS(modules) {
   const fixtureWSPath = path.join(__dirname, 'fixtureWS');
   const prepareWS = require('../gulp/common/generate-task/prepare-ws.js');
   const TaskParameters = require('../gulp/common/classes/task-parameters');
   const Config = require('../gulp/builder/classes/configuration');

   fs.removeSync(fixtureWSPath);

   const config = new Config();
   config.cachePath = fixtureWSPath;
   config.initCore = true;
   config.modules = modules;
   const taskParameters = new TaskParameters(config, null);
   return new Promise((resolve) => {
      prepareWS(taskParameters)(resolve);
   });
}

process.on('unhandledRejection', (reason, p) => {
   // eslint-disable-next-line no-console
   console.log(
      "[00:00:00] [ERROR] Критическая ошибка в работе builder'а. ",
      'Unhandled Rejection at:\n',
      p,
      '\nreason:\n',
      reason
   );
});

function getPlatformModules() {
   const nodeModulesPath = path.normalize(path.join(__dirname, '../node_modules'));
   const ModuleInfo = require('../gulp/common/classes/base-module-info');
   const getModuleInfo = function(moduleName, relativePath) {
      return {
         name: moduleName,
         path: path.join(nodeModulesPath, relativePath),
         required: true
      };
   };
   return [
      new ModuleInfo(getModuleInfo('WS.Core', 'sbis3-ws/WS.Core')),
      new ModuleInfo(getModuleInfo('RequireJsLoader', 'wasaby-requirejs-loader/RequireJsLoader')),
      new ModuleInfo(getModuleInfo('WasabyLoader', 'wasaby-requirejs-loader/WasabyLoader')),
      new ModuleInfo(getModuleInfo('Application', 'wasaby-app/src/Application')),
      new ModuleInfo(getModuleInfo('View', 'sbis3-ws/View')),
      new ModuleInfo(getModuleInfo('Vdom', 'sbis3-ws/Vdom')),
      new ModuleInfo(getModuleInfo('Router', 'Router/Router')),
      new ModuleInfo(getModuleInfo('Inferno', 'saby-inferno/Inferno')),
      new ModuleInfo(getModuleInfo('Types', 'saby-types/Types')),
      new ModuleInfo(getModuleInfo('I18n', 'saby-i18n/I18n')),
      new ModuleInfo(getModuleInfo('Env', 'rmi/src/client/Env')),
      new ModuleInfo(getModuleInfo('SbisEnv', 'rmi/src/client/SbisEnv')),
      new ModuleInfo(getModuleInfo('Browser', 'rmi/src/client/Browser')),
      new ModuleInfo(getModuleInfo('UI', 'saby-ui/UI'))
   ];
}

let initialized = false;
async function init() {
   if (!initialized) {
      try {
         const modules = getPlatformModules();
         await copyWS(modules);
         const requiredModules = modules.map(moduleInfo => moduleInfo.name);
         process.env['require-loader-path'] = path.join(__dirname, 'fixtureWS/platform/RequireJsLoader');
         require('../gulp/common/node-ws').init(requiredModules);
         initialized = true;
      } catch (e) {
         // eslint-disable-next-line no-console
         console.log(`[00:00:00] [ERROR] Исключение при инициализации тестов: ${e.message}`);
         // eslint-disable-next-line no-console
         console.log(`Stack: ${e.stack}`);
         process.exit(1);
      }
   }
}

module.exports = init;
