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
   constructor(moduleName, moduleResponsible, modulePath, required, depends) {
      this.name = moduleName;
      this.responsible = moduleResponsible;
      this.path = modulePath;
      this.required = required;
      this.depends = depends || [];
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
   symlinkInputPathToAvoidProblems(cachePath, buildTask) {
      const needSymlink = buildTask || isShareOnWindows(this.path) || getIllegalSymbolInPath(this.path);
      if (needSymlink) {
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
            // it's not an error. Symlink doesn't exists in first build without builder cache
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
