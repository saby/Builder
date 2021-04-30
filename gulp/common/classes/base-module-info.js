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
   constructor(baseModuleInfo) {
      const {
         name,
         responsible,
         required,
         rebuild,
         depends,
         changedFiles
      } = baseModuleInfo;
      const modulePath = baseModuleInfo.path;
      this.name = name;
      this.responsible = responsible;
      this.path = modulePath;
      this.required = required;
      this.rebuild = rebuild;
      this.depends = depends || [];
      this.cache = {};
      this.appRoot = path.dirname(modulePath).replace(/\\/g, '/');
      if (changedFiles) {
         this.changedFiles = [];
         changedFiles.forEach((currentFile) => {
            if (currentFile.endsWith('.ts')) {
               this.typescriptChanged = true;
            }
            this.changedFiles.push(currentFile);
         });
      }
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
            const errorMessage = 'An error occurred while creating symlink:\n' +
               `from: ${this.path}\n` +
               `to: ${newPath}\n` +
               'Make sure you\'re running your CLI or IDE with administrator rules(or with sudo rules in linux)\n' +
               `Error: ${err.message}`;
            throw new Error(errorMessage);
         }
         this.path = newPath;
         this.appRoot = path.dirname(newPath).replace(/\\/g, '/');
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
