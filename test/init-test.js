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
   config.needTemplates = true;
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
   return [
      new ModuleInfo('WS.Core', '', path.join(nodeModulesPath, 'sbis3-ws/WS.Core'), true),
      new ModuleInfo('WS.Data', '', path.join(nodeModulesPath, 'ws-data/WS.Data'), true),
      new ModuleInfo('View', '', path.join(nodeModulesPath, 'sbis3-ws/View'), true),
      new ModuleInfo('Vdom', '', path.join(nodeModulesPath, 'sbis3-ws/Vdom'), true),
      new ModuleInfo('Router', '', path.join(nodeModulesPath, 'Router/Router'), true),
      new ModuleInfo('Inferno', '', path.join(nodeModulesPath, 'sbis3-ws/Inferno'), true),
      new ModuleInfo('Controls', '', path.join(nodeModulesPath, 'sbis3-controls/Controls'), true),
      new ModuleInfo('Types', '', path.join(nodeModulesPath, 'saby-types/Types'), true),
      new ModuleInfo('Env', '', path.join(nodeModulesPath, 'rmi/src/client/Env'), true),
      new ModuleInfo('Browser', '', path.join(nodeModulesPath, 'rmi/src/client/Browser'), true)
   ];
}

let initialized = false;
async function init() {
   if (!initialized) {
      try {
         const modules = getPlatformModules();
         await copyWS(modules);
         const requiredModules = modules.map(moduleInfo => moduleInfo.name);
         process.env['ws-core-path'] = path.join(__dirname, 'fixtureWS/platform/WS.Core');
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
