/**
 * Подключение ws для gulp. Использовать ТОЛЬКО в пуле воркеров.
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path'),
   requireJS = require('saby-units/lib/requirejs/r'),
   logger = require('../../lib/logger').logger();

const formatMessage = function(message) {
   if (typeof message === 'string') {
      return message;
   }
   return JSON.stringify(message);
};

const wsLogger = {
   error(tag, msg, err) {
      // ошибки от ядра выводим пока как warning.
      // сначала нужно проверить, что сообщения от WS могут быть полезны в принципе.
      // не роняем сборку, а аккуратно и постепенно вычищаем от ошибок.
      logger.warning({
         error: err,
         message: `WS error::${tag}::${formatMessage(msg)}`
      });
   },
   warn(tag, msg, err) {
      logger.warning({
         error: err,
         message: `WS warning::${tag}::${formatMessage(msg)}`
      });
   },
   info(tag, msg) {
      logger.info(`WS::${tag}::${formatMessage(msg)}`);
   },
   log(tag, msg) {
      logger.debug(`WS::${tag}::${formatMessage(msg)}`);
   }
};

function initWs(requiredModules) {
   logger.debug(`В worker передан параметр require-loader-path=${process.env['require-loader-path']}`);
   const RequireJsLoaderPath = process.env['require-loader-path'];
   const appRoot = path.dirname(RequireJsLoaderPath);

   global.wsConfig = {
      appRoot,
      wsRoot: path.join(appRoot, '/WS.Core'),
      resourceRoot: appRoot
   };
   global.wsBindings = {
      ITransport() {
         const e = new Error();
         throw new Error(`ITransport is not implemented in build environment.${e.stack}`);
      },
      ILogger() {
         return wsLogger;
      }
   };
   global.rk = function rk(key) {
      let resultKey = key;
      const index = resultKey.indexOf('@@');
      if (index > -1) {
         resultKey = resultKey.substr(index + '@@'.length);
      }
      return resultKey;
   };

   // set baseUrl to get AMD-based config of RequireJsLoader
   global.requirejs = requireJS.config({
      baseUrl: appRoot
   });
   global.define = requireJS.define;


   const requireJSConfig = global.requirejs('RequireJsLoader/config');

   // apply RequireJsLoader/config for current requirejs from saby-units
   requireJSConfig.applyConfig(requireJS, global.wsConfig);

   // set configured requirejs as global for further needs
   global.requirejs = requireJS;
   const loadContents = global.requirejs('Core/load-contents');
   const modulesForAppContents = {};
   requiredModules.forEach((currentModule) => {
      modulesForAppContents[currentModule] = {
         path: path.join(appRoot, currentModule)
      };
   });
   const appContents = {
      modules: modulesForAppContents
   };
   loadContents(appContents, true, { resources: '/' });

   // common core
   global.requirejs('Core/core');
   global.requirejs('Lib/core');

   /**
    * These utilities below must be downloaded immediately to make sure it'll be saved in requirejs
    * cache properly and will have correct API to work further with
    */
   // needed for xhtml localization
   global.requirejs('Core/markup/ParserUtilities');

   // needed for xhtml build
   global.requirejs('Core/js-template-doT');

   // needed by templates processor
   global.requirejs('Application/Initializer');
   global.requirejs('UI/Builder');
}

let initialized = false;
module.exports = {

   /**
    * Инициализация ядра платформы WS.
    */
   init(requiredModules) {
      try {
         if (!initialized) {
            initWs(requiredModules);
            initialized = true;
         }
      } catch (e) {
         e.message = `Ошибка инициализации ядра платформы WS: ${e.stack || e}`;
         throw e;
      }
   }
};
