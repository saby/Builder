/**
 * Вспомогательные функциия для сборки
 * @author Бегунов Ал. В.
 */
'use strict';

const path = require('path'),
   os = require('os'),
   fs = require('fs-extra'),
   logger = require('../../lib/logger').logger(),
   getLogLevel = require('../../lib/get-log-level'),
   workerPool = require('workerpool');

/**
 * check source file necessity in output directory by
 * given gulp configuration
 * @param config - current gulp configuration
 * @param file - current file
 * @returns {boolean}
 */
function checkSourceNecessityByConfig(config, extension) {
   if (!config.typescript && extension === '.ts') {
      return false;
   }

   if (!config.less && extension === '.less') {
      return false;
   }

   if (!config.wml && ['.wml', '.tmpl'].includes(extension)) {
      return false;
   }

   if (!config.deprecatedXhtml && extension === '.xhtml') {
      return false;
   }
   return true;
}

/**
 * Функция, которая нужна в сборке для выбора между gulp.dest и gulp.symlink
 * @param {BuildConfiguration} config конфигурация сборки
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {Function} возвращаем функцию для gulp-if
 */
function needSymlink(config, moduleInfo) {
   const hasLocalization = config.localizations.length > 0;
   return (file) => {
      // в релизе нельзя применять симлинки
      if (config.isReleaseMode || !config.symlinks) {
         return false;
      }

      // при локализации изменяются файлы с вёрсткой, нельзя использовать симлинки
      if (hasLocalization && ['.html', '.tmpl', 'xhtml'].includes(file.extname)) {
         return false;
      }

      // нельзя использовать симлинки для файлов, которые мы сами генерируем.
      // абсолютный путь в relativePath  может получиться только на windows, если не получилось построить относительный
      const relativePath = path.relative(moduleInfo.path, file.history[0]);
      if (relativePath.includes('..') || path.isAbsolute(relativePath)) {
         return false;
      }

      // если была транслитерация путей(признак file.history.length > 1), то симлинки не работают.
      // ошибка в самом gulp.
      return file.history.length === 1;
   };
}

/**
 * Генерация задачи загрузки кеша сборки
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {function(): *}
 */
function generateTaskForLoadCache(taskParameters) {
   return async function loadCache() {
      const startTime = Date.now();
      const { modulesForPatch } = taskParameters.config;
      await taskParameters.cache.load(modulesForPatch && modulesForPatch.length > 0);
      taskParameters.storeTaskTime('loadCache', startTime);
   };
}

/**
 * Генерация задачи инициализации пула воркеров
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {function(): *}
 */
function generateTaskForInitWorkerPool(taskParameters) {
   return async function initWorkerPool() {
      const startTime = Date.now();

      // переменная окружения ws-core-path задана в тестах
      let wsCorePath = process.env['ws-core-path'];

      // WS.Core - название модуля в SDK
      if (!wsCorePath) {
         const possibleWsCorePath = path.join(taskParameters.config.cachePath, 'platform/WS.Core');
         if (await fs.pathExists(possibleWsCorePath)) {
            wsCorePath = possibleWsCorePath;
         }
      }

      let maxWorkers = taskParameters.config.rawConfig['max-workers-for-builder'];

      /**
       * throw an error, if custom worker count more than
       * system max threads - 1 (1 thread for Node.Js main process)
       */
      if (maxWorkers && maxWorkers > (os.cpus().length - 1)) {
         throw new Error(`Custom max worker's count must be less than ${os.cpus().length} for current executing machine!`);
      }
      if (!maxWorkers) {
         maxWorkers = os.cpus().length - 1;
      }
      const requiredModules = taskParameters.config.modules
         .filter(currentModule => currentModule.required)
         .map(currentModule => currentModule.name);

      const workerPoolConfig = {
         maxWorkers: maxWorkers || 1,
         forkOpts: {
            env: {
               logs: getLogLevel(process.argv),
               'ws-core-path': wsCorePath,
               'main-process-cwd': process.cwd(),
               'required-modules': JSON.stringify(requiredModules)
            },
            execArgv: ['--max-old-space-size=1024']
         }
      };

      // save worker's config in cache to use it as debug info
      await fs.outputJson(
         path.join(taskParameters.config.cachePath, 'workerpool-config.json'),
         { systemMaxWorkers: os.cpus().length, ...workerPoolConfig }
      );

      // Нельзя занимать больше ядер чем есть. Основной процесс тоже потребляет ресурсы
      taskParameters.setWorkerPool(
         workerPool.pool(path.join(__dirname, '../common/worker.js'), workerPoolConfig)
      );
      taskParameters.storeTaskTime('initWorkerPool', startTime);
   };
}

/**
 * Генерация задачи убийства пула воркеров
 * @param {TaskParameters} taskParameters параметры для задач
 * @returns {function(): *}
 */
function generateTaskForTerminatePool(taskParameters) {
   return function terminatePool() {
      return taskParameters.pool.terminate();
   };
}

/**
 * Оборачивает функцию в воркере, чтобы была возможность вернуть ошибки и варнинги от WS.
 * Работает в тандеме с gulp/helpers/exec-in-pool.js
 * @param {Function} func функция, которую оборачиваем
 * @returns {Function}
 */
function wrapWorkerFunction(func) {
   return async(funcArgs, filePath = null, moduleInfo = null) => {
      logger.setInfo(filePath, moduleInfo);
      let result;
      try {
         result = func(...funcArgs);
         if (result instanceof Promise) {
            result = await result;
         }
      } catch (error) {
         return [{ message: error.message, stack: error.stack }, null, logger.getMessageForReport()];
      }
      return [null, result, logger.getMessageForReport()];
   };
}


module.exports = {
   needSymlink,
   generateTaskForLoadCache,
   generateTaskForInitWorkerPool,
   generateTaskForTerminatePool,
   wrapWorkerFunction,
   checkSourceNecessityByConfig
};
