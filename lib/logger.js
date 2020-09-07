/* eslint-disable no-console, max-classes-per-file */

'use strict';
const humanize = require('humanize');
const fs = require('fs-extra');
const path = require('path');
let logger = null;

function formatEntry(obj, level) {
   let formattedMessage = '';
   let formattedMessageWithStack = '';
   if (typeof obj === 'string') {
      formattedMessage = obj;
   } else {
      const messages = [];

      if (obj.hasOwnProperty('message') && obj.message) {
         messages.push(obj.message);
      }
      if (obj.hasOwnProperty('error') && obj.error && obj.error.message) {
         messages.push(obj.error.message);
      }

      const locations = [];
      if (obj.hasOwnProperty('moduleInfo') && obj.moduleInfo && obj.moduleInfo.nameWithResponsible) {
         locations.push(`module: ${obj.moduleInfo.nameWithResponsible}`);
      }
      if (obj.hasOwnProperty('filePath') && obj.filePath) {
         locations.push(`file: ${obj.filePath}`);
      }
      if (obj.hasOwnProperty('error') && obj.error && obj.error.stack) {
         formattedMessageWithStack = `Stack: ${obj.error.stack}`;
      }
      let formattedLocation = '';
      if (locations.length > 0) {
         formattedLocation = `location: [${locations.join(', ')}] `;
      }
      formattedMessage = `${formattedLocation}${messages.join(': ')}`;
   }

   let formattedLevel = '';
   if (level) {
      formattedLevel = `[${level}] `;
   }

   return {
      message: `${formattedLevel}${formattedMessage}`,
      stack: formattedMessageWithStack
   };
}

class Logger {
   constructor(logsLevel) {
      this._hasErrors = false;
      this._hasWarnings = false;
      this._logInfo = !logsLevel || logsLevel === 'info';
      this._logWarnings = this._logInfo || logsLevel === 'warning';
   }

   //
   getCorrectExitCode(resultCode, exitWithWarning = true) {
      if (resultCode === 0) {
         if (this._hasErrors) {
            return 1;
         }
         if (this._hasWarnings && exitWithWarning) {
            // grunt такой же код выдаёт на варнинги. legacy, которое поддержано в jinnee
            return 6;
         }
         return 0;
      }

      /**
       * all another exit codes means fatal error of main Node.JS process.
       * Example: out of memory(OOM)
       */
      return 1;
   }
}

class GulpLogger extends Logger {
   constructor(logsLevel) {
      super(logsLevel);
      this._lastPercentStr = '';
      this._messages = [];
      this._appInfo = {
         application: '',
         responsible: ''
      };
   }

   setBaseInfo(application, responsible) {
      this._appInfo = {
         application,
         responsible
      };
   }

   error(message) {
      this._hasErrors = true;
      this._consoleLog('ERROR', message);
      this._addMessageForReport('error', message, this._appInfo);
   }

   warning(message) {
      this._hasWarnings = true;
      if (this._logWarnings) {
         this._consoleLog('WARNING', message);
      }
      this._addMessageForReport('warning', message, this._appInfo);
   }

   info(message) {
      if (this._logInfo) {
         this._consoleLog('INFO', message);
      }
   }

   debug(message) {
      if (this._logInfo) {
         this._consoleLog('', message);
      }
   }

   progress(percent) {
      const currentPercentStr = percent.toFixed(0);
      if (currentPercentStr !== this._lastPercentStr) {
         // выводим без [INFO]
         this._consoleLog('', `[PERCENT_COMPLETE] ${currentPercentStr}`);
         this._lastPercentStr = currentPercentStr;
      }
   }

   /* obj может быть строкой или объектом: {
      code: 1,
      message: 'Ошибка при обработке шаблона',
      error: error,
      moduleInfo: moduleInfo,
      filePath: file.history[0]
   }
   */
   _consoleLog(level, obj) {
      const entry = formatEntry(obj, level);
      console.log(`[${humanize.date('H:i:s')}] ${entry.message}`);
      if (entry.stack) {
         this.debug(entry.stack);
      }
   }

   _addMessageForReport(level, obj, appInfo) {
      const result = {
         level,
         message: '',
         'cld_name': appInfo.application,
         'cld_responsible': appInfo.responsible
      };

      if (typeof obj === 'string') {
         result.message = obj;
      } else {
         if (obj.hasOwnProperty('message') && obj.message) {
            result.message += obj.message;
         }
         if (obj.hasOwnProperty('error') && obj.error && (obj.error.message || obj.error.stack)) {
            if (result.message) {
               result.message += '\nError: ';
            }
            if (obj.error.message) {
               result.message += obj.error.message;
            }
            if (obj.error.stack) {
               result.message += `\nStack: ${obj.error.stack}`;
            }
         }

         if (obj.hasOwnProperty('moduleInfo') && obj.moduleInfo) {
            result.module = obj.moduleInfo.name;
            result.responsibleOfModule = obj.moduleInfo.responsible;
         }
         if (obj.hasOwnProperty('filePath') && obj.filePath) {
            result.file = obj.filePath;
         }
      }
      this._messages.push(result);
   }

   addMessagesFromWorker(messages) {
      if (messages) {
         for (const msg of messages) {
            this._messages.push(msg);
         }
      }
   }

   getMessageForReport() {
      return this._messages;
   }

   getMessagesLevel() {
      return {
         warnings: this._hasWarnings,
         errors: this._hasErrors
      };
   }

   processWorkerCriticalErrors(logsPath) {
      const workerFolder = path.join(logsPath, 'worker');
      if (fs.existsSync(workerFolder)) {
         const filesToRead = fs.readdirSync(workerFolder);
         filesToRead.forEach((currentFileName) => {
            const errorMessage = fs.readJsonSync(path.join(workerFolder, currentFileName));
            this.error(errorMessage);
         });
      }
   }

   saveLoggerReport(logFolder) {
      const resultPath = logFolder || process.cwd();
      this.processWorkerCriticalErrors(resultPath);
      const logsLevels = this.getMessagesLevel();
      const messages = this.getMessageForReport();
      const reportFilePath = path.join(resultPath, 'builder_report.json');
      fs.outputJsonSync(reportFilePath, { messages });
      let resultMessage = 'build was completed ';
      if (logsLevels.warnings || logsLevels.errors) {
         resultMessage += `with warnings or errors. See ${reportFilePath} for additional info!`;
      } else {
         resultMessage += 'successfully!';
      }

      console.log(resultMessage);
   }

   reset() {
      this._lastPercentStr = '';
      this._messages = [];
      this._appInfo = {
         application: '',
         responsible: ''
      };
      this._hasErrors = false;
      this._hasWarnings = false;
   }
}
class WorkerLogger extends GulpLogger {
   constructor(logsLevel) {
      super(logsLevel);
      this._filePath = null;
      this._moduleInfo = null;
   }

   setInfo(filePath = null, moduleInfo = null) {
      this._filePath = filePath;
      this._moduleInfo = moduleInfo;
      this._messages = [];
   }

   error(message) {
      this._outputWithInfo('error', message);
   }

   warning(message) {
      this._outputWithInfo('warning', message);
   }

   info(message) {
      this._outputWithInfo('info', message);
   }

   debug(message) {
      this._outputWithInfo('debug', message);
   }

   _outputWithInfo(level, message) {
      if (typeof message === 'object') {
         super[level]({
            ...message,
            filePath: this._filePath,
            moduleInfo: this._moduleInfo
         });
      } else {
         super[level]({
            message,
            filePath: this._filePath,
            moduleInfo: this._moduleInfo
         });
      }
   }
}
module.exports = {
   formatEntry,
   setGulpLogger(logsLevel) {
      if (!logger) {
         logger = new GulpLogger(logsLevel);
      }
      return logger;
   },
   setWorkerLogger(logsLevel) {
      if (!logger) {
         logger = new WorkerLogger(logsLevel);
      }
      return logger;
   },
   logger() {
      if (!logger) {
         throw new Error('Логгер не был инициализирован!');
      }
      return logger;
   },
   reset() {
      logger = null;
   }
};
