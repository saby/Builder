'use strict';

// подключение ws для gulp.

const path = require('path'),
   requireJS = require('requirejs'),
   logger = require('../../lib/logger').logger();

const dblSlashes = /\\/g;
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

function removeLeadingSlash(filePath) {
   let resultPath = filePath;
   if (resultPath) {
      const head = resultPath.charAt(0);
      if (head === '/' || head === '\\') {
         resultPath = resultPath.substr(1);
      }
   }
   return resultPath;
}

function initWs() {
   let appRoot, wsRoot, moduleView, moduleControls, moduleWSData;

   if (process.env && process.env.hasOwnProperty('ws-core-path') && process.env['ws-core-path']) {
      // Если в проекте есть модуль WS.Core, то используем платформу из кода проекта.
      // Это нужно для беспроблемного прохождения тестов WS и Controls, а также сборки онлайна.
      // Часто код WS должен быть одинаковым на стенде и в билдере, иначе стенд разваливается.
      // При этом API, которое предоставляет WS для Builder'а, меняется редко.
      // Считаем, что все модули платформы лежат в одной директории.
      logger.debug(`В worker передан параметр ws-core-path=${process.env['ws-core-path']}`);
      appRoot = path.dirname(process.env['ws-core-path']);

      // для wsRoot слэш в начале обязателен
      wsRoot = '/WS.Core';
      moduleView = 'View';
      moduleControls = 'Controls';
      moduleWSData = 'WS.Data';
   } else {
      // Есть в проекте нет своего модуля WS.Core, то подгружаем из node_modules.
      // Это нужно для юнит тестов и для сервиса спецификаций.
      // Для дистрибутива серсиса спецификаций не нужны модули платформы
      logger.debug('В worker не передан параметр ws-core-path, поэтому ws будет взят из node_modules');
      appRoot = path.join(__dirname, '../../node_modules').replace(dblSlashes, '/');

      // для wsRoot слэш в начале обязателен
      wsRoot = '/sbis3-ws/ws/';
      moduleView = 'sbis3-ws/View';
      moduleControls = 'sbis3-controls/Controls';
      moduleWSData = 'ws-data/WS.Data';
   }

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
   const config = requireJSConfig(appRoot, removeLeadingSlash(wsRoot), removeLeadingSlash(resourceRoot), {
      waitSeconds: 20,
      nodeRequire: require
   });
   global.requirejs = requireJS.config(config);
   global.requirejs(path.join(appRoot, wsRoot, 'lib/core.js'));
   global.requirejs('Core/core');
   const loadContents = global.requirejs('Core/load-contents');
   const appContents = {
      jsModules: {},
      modules: {
         View: moduleView,
         Controls: moduleControls,
         'WS.Data': moduleWSData
      },
      requirejsPaths: {
         View: moduleView,
         Controls: moduleControls,
         'WS.Data': moduleWSData
      }
   };
   loadContents(appContents, true, { service: appRoot });
}

let initialized = false;
module.exports = {
   init() {
      try {
         if (!initialized) {
            initWs();
            initialized = true;
         }
      } catch (e) {
         e.message = `Ошибка инициализации ядра платформы WS: ${e.message}`;
         throw e;
      }
   }
};
