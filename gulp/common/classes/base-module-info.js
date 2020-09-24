/* eslint-disable no-sync */
/**
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path'),
   fs = require('fs-extra'),
   transliterate = require('../../../lib/transliterate');

const ILLEGAL_SYMBOLS_FOR_PATH = ['[', ']'];

/**
 * Класс с базовой информацией о модуле. Используется как база для сборки статики и для сбора фраз локализации.
 */
class ModuleInfo {
   constructor(moduleName, moduleResponsible, modulePath, required, rebuild, depends) {
      this.name = moduleName;
      this.responsible = moduleResponsible;
      this.path = modulePath;
      this.required = required;
      this.rebuild = rebuild;
      this.depends = depends || [];
      this.cache = {};

      // TODO learn jinnee to set SDK identity for modules in gulp_config
      this.sdkElement = modulePath.includes('link_to_sdk');
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
         const newPath = path.join(cachePath, 'temp-modules', path.basename(this.path));
         if (getIllegalSymbolInPath(newPath)) {
            throw new Error(`Временный пусть до модуля содержит не корректный символ "${getIllegalSymbolInPath(newPath)}"`);
         }
         if (isShareOnWindows(cachePath)) {
            throw new Error('На windows путь до кеша не может быть сетевым .');
         }
         try {
            fs.ensureSymlinkSync(this.path, newPath, 'dir');
         } catch (err) {
            const errorMessage = 'An error occured while creating symlinks to source modules.\n' +
               'Make sure you\'re running your CLI or IDE with administrator rules(or with sudo rules in linux)';
            throw new Error(errorMessage);
         }
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
