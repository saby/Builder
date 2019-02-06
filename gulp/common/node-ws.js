/**
 * Подключение ws для gulp. Использовать ТОЛЬКО в пуле воркеров.
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   requireJS = require('requirejs'),
   logger = require('../../lib/logger').logger();

const resourceRoot = '/';

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
   // Используем платформу из кода проекта.
   // Это нужно для беспроблемного прохождения тестов WS и Controls, а также сборки онлайна.
   // Часто код WS должен быть одинаковым на стенде и в билдере, иначе стенд разваливается.
   // При этом API, которое предоставляет WS для Builder'а, меняется редко.
   // Считаем, что все модули платформы лежат в одной директории.
   logger.debug(`В worker передан параметр ws-core-path=${process.env['ws-core-path']}`);
   const WSFullPath = process.env['ws-core-path'];
   const appRoot = path.dirname(WSFullPath);


   // для wsRoot слэш в начале обязателен
   const wsRoot = `/${path.basename(WSFullPath)}`;

   global.wsConfig = {
      appRoot,
      wsRoot,
      resourceRoot
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
   global.requirejs = requireJS;
   global.define = requireJS.define;

   // eslint-disable-next-line global-require
   const requireJSConfig = require(path.join(appRoot, wsRoot, 'ext/requirejs/config.js'));
   const config = requireJSConfig(appRoot, WSFullPath, appRoot, {
      waitSeconds: 20,
      nodeRequire: require
   });
   global.requirejs = requireJS.config(config);
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
   global.requirejs('Core/core');
   global.requirejs('Lib/core');
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
         e.message = `Ошибка инициализации ядра платформы WS: ${e.message}`;
         throw e;
      }
   }
};
