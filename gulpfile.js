/* eslint-disable global-require */

/**
 * Основной исполняемый файл Builder'а. Подробности по запуску в README.md
 * @author Kolbeshin F.A.
 */

'use strict';

const NODE_VERSION = '10.14.2';
const getLogsLevel = require('./lib/get-log-level');
const semver = require('semver');

try {
   // В самом начале проверим версию node. используем минимум возможностей node.js и ES6
   if (!semver.satisfies(process.versions.node, `>=${NODE_VERSION}`)) {
      // не рискуем выводить через logger
      // eslint-disable-next-line no-console
      console.log(`[00:00:00] [ERROR] Для запуска требуется Node.js v${NODE_VERSION} или выше`);
      process.exit(1);
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
      process.exit(1);
   });

   // не всегда понятно по 10 записям, откуда пришёл вызов.
   Error.stackTraceLimit = 100;

   // логгер - прежде всего
   const logger = require('./lib/logger').setGulpLogger(getLogsLevel(process.argv));

   // важно вернуть правильный код при выходе. сборка должна падать, если есть ошибки
   process.on('exit', (resultCode) => {
      logger.saveLoggerReport(process.env.logFolder);
      logger.info(`Main process was exited with code: ${resultCode}`);
      const exitCode = logger.getCorrectExitCode(resultCode);
      process.exit(exitCode);
   });

   const gulp = require('gulp');
   logger.debug(`Параметры запуска: ${JSON.stringify(process.argv)}`);

   // т.к. мы строим Workflow на основе файла конфигурации, то нужно отделить build от grabber,
   // чтобы не выполнялись лишние действия
   if (process.argv.includes('buildOnChange')) {
      const generateBuildWorkflowOnChange = require('./gulp/builder/generate-workflow-on-change.js');
      gulp.task('buildOnChange', generateBuildWorkflowOnChange(process.argv));
   } else if (process.argv.includes('buildOnChangeWatcher')) {
      const generateBuildWorkflow = require('./gulp/builder/generate-workflow.js');
      gulp.task('buildOnChangeWatcher', () => {
         const { WatcherTask, SOURCE_ROOT } = require('./gulp/builder/generate-watcher');

         // run common build to catch all of changes that was happened while watcher wasn't working
         generateBuildWorkflow(process.argv)();

         // run watcher only after common build was completed
         process.on('beforeExit', () => {
            const gulpWatcher = gulp.watch(SOURCE_ROOT);
            const addSubscriptions = (events) => {
               const watcher = new WatcherTask();
               watcher.debounce();
               events.forEach(currentEvent => gulpWatcher.on(
                  currentEvent, watcher.updateChangedFiles.bind(watcher)
               ));
            };

            // we have to add eventListeners manually, otherwise we cant get a path of a file to build
            addSubscriptions(['change', 'addDir', 'add', 'unlink', 'unlinkDir']);
         });
      });
   } else if (process.argv.includes('runTypescript')) {
      const generateWorkflowTypescript = require('./gulp/builder/generate-workflow-typescript');
      gulp.task('runTypescript', generateWorkflowTypescript(process.argv));
   } else if (process.argv.includes('build')) {
      const generateBuildWorkflow = require('./gulp/builder/generate-workflow.js');
      gulp.task('build', generateBuildWorkflow(process.argv));
   } else if (process.argv.includes('collectWordsForLocalization')) {
      const generateGrabberWorkflow = require('./gulp/grabber/generate-workflow.js');
      gulp.task('collectWordsForLocalization', generateGrabberWorkflow(process.argv));
   } else {
      logger.error('Используется неизвестная задача. Известные задачи: "build" и "collectWordsForLocalization".');
   }
} catch (e) {
   // eslint-disable-next-line no-console
   console.log(`[00:00:00] [ERROR] Исключение при работе builder'а: ${e.message}`);
   // eslint-disable-next-line no-console
   console.log(`Stack: ${e.stack}`);
   process.exit(1);
}
