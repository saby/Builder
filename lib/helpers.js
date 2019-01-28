'use strict';

const minimatch = require('minimatch');
const path = require('path');
const zlib = require('zlib');
const logger = require('./logger').logger();

const isWindows = process.platform === 'win32';
const gzOptions = {
   level: zlib.Z_BEST_COMPRESSION,
   strategy: zlib.Z_DEFAULT_STRATEGY
};
const dblSlashes = /\\/g;
const deprecatedControlsToSave = [
   'ModalOverlay',
   'LoadingIndicator',
   'ProgressBar',
   'FieldString',
   'LinkButton',
   'Button',
   'FieldAbstract',
   'ButtonAbstract',
   'Menu'
];

function validateFile(file, patterns) {
   let passed = false;

   for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const neg = pattern.charAt(0) === '!';

      if (minimatch(file, pattern)) {
         if (!neg) {
            passed = true;
         }
      } else if (neg) {
         passed = false;
         break;
      }
   }

   return passed;
}

function sortObject(obj, comparator) {
   const sorted = {};
   Object.keys(obj)
      .sort(comparator)
      .forEach((key) => {
         const val = obj[key];
         if (Array.isArray(val)) {
            sorted[key] = val.sort();
         } else if (val instanceof Object) {
            sorted[key] = sortObject(val, comparator);
         } else {
            sorted[key] = val;
         }
      });
   return sorted;
}

function gzip(data) {
   return new Promise((resolve, reject) => {
      zlib.gzip(data, gzOptions, (err, compressed) => {
         if (err) {
            reject(err);
         } else {
            resolve(compressed);
         }
      });
   });
}

// получить первую папку в относительном пути. нужно для получения папки модуля
function getFirstDirInRelativePath(relativePath) {
   const parts = relativePath.replace(dblSlashes, '/').split('/');

   // в пути должно быть минимум два элемента: имя папки модуля и имя файла.
   if (parts.length < 2) {
      return relativePath;
   }

   // если путь начинается со слеша, то первый элемент - пустая строка
   return parts[0] || parts[1];
}

/**
 * Преобразует пути к одному формату. Для сетевых путей на windows слеш "\", а для всех остальных "/".
 * Нужно, например, для вывода путей в итоговые файлы и для сравнения путей на эквивалетность.
 * @param {string} filePath путь до файла или папки
 * @returns {string}
 */

function prettifyPath(filePath) {
   if (!filePath || typeof filePath !== 'string') {
      return '';
   }

   // специальная обработка для путей сетевого SDK, что используется для сборки под Windows на Jenkins
   if (isWindows && /^[\\|/]{2}.*/.test(filePath)) {
      return `\\${filePath.replace(/\//g, '\\').replace(/\\\\/g, '\\')}`;
   }

   return unixifyPath(filePath);
}

/**
 * Преобразует пути к unix формату. Сетевой путь в windows станет не рабочим от такого преобразования.
 * Нужно, например, для сравнения путей с помощью метода endsWith.
 * @param {string} filePath путь до файла или папки
 * @returns {string}
 */
function unixifyPath(filePath) {
   if (!filePath || typeof filePath !== 'string') {
      return '';
   }

   return path
      .normalize(filePath)
      .replace(dblSlashes, '/')
      .replace(/\/\//g, '/');
}

function removeLeadingSlash(filePath) {
   let newFilePath = filePath;
   if (newFilePath) {
      const head = newFilePath.charAt(0);
      if (head === '/' || head === '\\') {
         newFilePath = newFilePath.substr(1);
      }
   }
   return newFilePath;
}

function removeLatestSlash(filePath) {
   if (filePath.endsWith('/') || filePath.endsWith('\\')) {
      return filePath.slice(0, filePath.length - 1);
   }
   return filePath;
}

const promisifyDeferred = function(deferred) {
   return new Promise((resolve, reject) => {
      deferred
         .addCallback((result) => {
            resolve(result);
         })
         .addErrback((error) => {
            reject(error);
         });
   });
};

/**
 * Сравнивает два объекта без рекурсии
 * @param {Object} a перый аргумент
 * @param {Object} b второй аргумент
 * @returns {boolean}
 */
function isEqualObjectFirstLevel(a, b) {
   if (!a || !b) {
      return false;
   }

   const arrKey = Object.keys(a);

   if (arrKey.length !== Object.keys(b).length) {
      return false;
   }

   return arrKey.every((key) => {
      if (b.hasOwnProperty(key) && a[key] === b[key]) {
         return true;
      }
      return false;
   });
}

/**
 * Удаляем из мета-данных о версионированных файлах информацию
 * о файлах, которые будут удалены при выполнении таски
 * оптимизации дистрибутива.
 * @param versionedMeta
 * @param fullPath
 */
function removeFileFromBuilderMeta(builderMeta, fullPath) {
   let removeFromVersioned;
   builderMeta.forEach((versionedModule) => {
      if (fullPath.endsWith(versionedModule)) {
         removeFromVersioned = versionedModule;
      }
   });
   if (removeFromVersioned) {
      logger.debug(`Удалили модуль ${fullPath} из мета-данных по версионированию`);
      const moduleIndex = builderMeta.indexOf(removeFromVersioned);
      builderMeta.splice(moduleIndex, 1);
   }
}

/**
 * Проверяем WS.Deprecated модули, нам необходимо оставить в папке
 * Controls только неймспейсы deprecatedControlsToSave
 * @param{String} fullPath - полный путь до копируемого файла
 * @returns {boolean} true - не удаляем. false - удаляем.
 */
function checkPathForDeprecatedToRemove(fullPath) {
   if (fullPath.includes('WS.Deprecated/Controls')) {
      let result = false;
      deprecatedControlsToSave.forEach((currentControl) => {
         if (fullPath.includes(`WS.Deprecated/Controls/${currentControl}/`)) {
            result = true;
         }
      });
      return result;
   }
   return true;
}

/**
 * Проверяем, нужно ли удалить модуль из оффлайн-приложения.
 * @param{String} prettyPath - путь до файла
 * @returns {boolean}
 */
function needToRemoveModuleForDesktop(prettyPath, projectName) {
   const isRetailOrPrestoOffline = projectName === 'retail-offline' || projectName === 'presto-offline';
   return !checkPathForDeprecatedToRemove(prettyPath) ||
      (isRetailOrPrestoOffline && prettyPath.includes('SBIS3.CONTROLS/themes/online')) ||
      prettyPath.includes('WS.Core/lib/Ext');
}

module.exports = {
   validateFile,
   sortObject,
   getFirstDirInRelativePath,
   prettifyPath,
   unixifyPath,
   removeLeadingSlash,
   removeLatestSlash,
   promisifyDeferred,
   gzip,
   isEqualObjectFirstLevel,
   removeFileFromBuilderMeta,
   needToRemoveModuleForDesktop
};
