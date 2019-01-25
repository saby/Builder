/* eslint-disable no-sync */
/**
 * @author Бегунов Ал. В.
 */

'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate');

const ILLEGAL_SYMBOLS_FOR_PATH = ['[', ']'];

/**
 * Класс с базовой информацией о модуле. Используется как база для сборки статики и для сбора фраз локализации.
 */
class ModuleInfo {
   constructor(moduleName, moduleResponsible, modulePath, required) {
      this.name = moduleName;
      this.responsible = moduleResponsible;
      this.path = modulePath;
      this.required = required;
   }

   get nameWithResponsible() {
      if (this.responsible) {
         return `${this.name} (${this.responsible})`;
      }
      return this.name;
   }

   get folderName() {
      return path.basename(this.path);
   }

   get runtimeModuleName() {
      return transliterate(this.folderName);
   }

   // если gulp не может обработать корректно путь до модуля, то попробуем сделать симлинк.
   symlinkInputPathToAvoidProblems(cachePath) {
      if (isShareOnWindows(this.path) || getIllegalSymbolInPath(this.path)) {
         logger.debug(`Необходим симлинк на модуль ${this.path}`);
         const newPath = path.join(cachePath, 'temp-modules', path.basename(this.path));
         if (getIllegalSymbolInPath(newPath)) {
            throw new Error(`Временный пусть до модуля содержит не корректный символ "${getIllegalSymbolInPath(newPath)}"`);
         }
         if (isShareOnWindows(cachePath)) {
            throw new Error('На windows путь до кеша не может быть сетевым .');
         }
         try {
            fs.unlinkSync(newPath);
         } catch (e) {
            logger.debug({
               message: 'Не смогли удалить старый симлинк или его не было',
               filePath: newPath,
               error: e
            });
         }
         fs.ensureSymlinkSync(this.path, newPath, 'dir');
         this.path = newPath;
      }
   }
}

function getIllegalSymbolInPath(folderPath) {
   // Gulp не правильно работает, если в путях встречаются некоторые особые символы. Например, [ и ]
   for (const illegalSymbol of ILLEGAL_SYMBOLS_FOR_PATH) {
      if (folderPath.includes(illegalSymbol)) {
         return illegalSymbol;
      }
   }
   return '';
}

function isShareOnWindows(folderPath) {
   // gulp.src не умеет работать c сетевыми путями на windows
   if (process.platform === 'win32') {
      return folderPath.startsWith('//') || folderPath.startsWith('\\\\');
   }
   return false;
}

module.exports = ModuleInfo;
