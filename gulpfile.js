/* eslint-disable global-require */

/**
 * Common executable file of Builder. More info see in README.md
 * @author Kolbeshin F.A.
 */

'use strict';

const NODE_VERSION = '12.16.0';
const getLogsLevel = require('./lib/get-log-level');
const semver = require('semver');

try {
   // First of all, check Node.Js version. Use maximum available technologies of current Tensor
   // LTS installed.
   if (!semver.satisfies(process.versions.node, `>=${NODE_VERSION}`)) {
      // don't use logger here, it's a bit risky.
      // eslint-disable-next-line no-console
      console.log(`[00:00:00] [ERROR] A minimal required Node.Js version is ${NODE_VERSION}. Current version: ${process.versions.node}`);
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

   // In some cases 10 records of error stack isn't enough to find out the original caller
   Error.stackTraceLimit = 100;

   // логгер - прежде всего
   const logger = require('./lib/logger').setGulpLogger(getLogsLevel(process.argv));

   // returning of a proper exit code is important here, build should be failed only if
   // there are actual errors(could be minor warnings)
   process.on('exit', (resultCode) => {
      logger.saveLoggerReport(process.env.logFolder);
      logger.info(`Main process was exited with code: ${resultCode}`);
      const exitCode = logger.getCorrectExitCode(resultCode);
      process.exit(exitCode);
   });

   const gulp = require('gulp');
   logger.debug(`Параметры запуска: ${JSON.stringify(process.argv)}`);

   // workflow is built by gulp_configuration file, thus we have to split build, grabber and watcher tasks
   // to avoid unnecessary operations
   if (process.argv.includes('buildOnChange')) {
      const generateBuildWorkflowOnChange = require('./gulp/builder/generate-workflow-on-change.js');
      gulp.task('buildOnChange', generateBuildWorkflowOnChange(process.argv));
   } else if (process.argv.includes('buildOnChangeWatcher')) {
      gulp.task('buildOnChangeWatcher', () => {
         const { WatcherTask, SOURCE_ROOT } = require('./gulp/builder/generate-watcher');
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
