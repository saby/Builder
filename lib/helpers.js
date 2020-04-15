/**
 * Common helpers for builder
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path');
const zlib = require('zlib');
const { isWindows } = require('./builder-constants');
const logger = require('./logger').logger();

const gzOptions = {
   level: zlib.Z_BEST_COMPRESSION,
   strategy: zlib.Z_DEFAULT_STRATEGY
};
const brotliOptions = {
   params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 7
   }
};
const dblSlashes = /\\/g;

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

/**
 * Get compressed to brotli source text.
 * Compress quality selected to 7. Reason:
 * optimal quality by speed and result size.
 * @param{ArrayBuffer} data source text
 * @returns {Promise}
 */
function brotli(data) {
   return new Promise((resolve, reject) => {
      zlib.brotliCompress(data, brotliOptions, (err, compressed) => {
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

function removeLeadingSlashes(filePath) {
   let newFilePath = filePath;
   if (newFilePath) {
      let head = newFilePath.charAt(0);
      while (head === '/' || head === '\\') {
         newFilePath = newFilePath.substr(1);
         head = newFilePath.charAt(0);
      }
   }
   return newFilePath;
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
 * Добавляем в корневой contents всю информацию из помодульного contents.
 * @param {Object} commonContents - корневой contents
 * @param {Object} currentContents - модульный contents
 */
function joinContents(commonContents, currentContents) {
   Object.keys(currentContents).forEach((currentOption) => {
      if (currentContents.hasOwnProperty(currentOption)) {
         switch (typeof currentContents[currentOption]) {
            case 'object':
               if (!commonContents.hasOwnProperty(currentOption)) {
                  commonContents[currentOption] = {};
               }
               Object.keys(currentContents[currentOption]).forEach((subOption) => {
                  if (currentContents[currentOption].hasOwnProperty(subOption)) {
                     commonContents[currentOption][subOption] = currentContents[currentOption][subOption];
                  }
               });
               break;
            case 'string':
               commonContents[currentOption] = currentContents[currentOption];
               break;
            default:
               break;
         }
      }
   });
}

/**
 * нас не интересуют:
 * не js-файлы
 * *.test.js - тесты
 * *.worker.js - воркеры
 * *.routes.js - роутинг. обрабатывается в отдельном плагин
 * файлы в папках design - файлы для макетирования в genie
 * jquery также не должен парситься, это модуль с cdn.
 * @param file
 * @returns {boolean|*}
 */
function componentCantBeParsed(file) {
   return file.extname !== '.js' ||
      file.path.endsWith('.worker.js') ||
      file.path.endsWith('.test.js') ||
      file.path.includes('/design/') ||
      file.basename.includes('jquery-min') ||
      file.basename.includes('jquery-full');
}

/**
 * sorts input array in descending order
 * @param array
 * @returns {*}
 */
function descendingSort(array, optionToCompare) {
   return array.sort((a, b) => {
      const firstValue = optionToCompare ? a[optionToCompare] : a;
      const secondValue = optionToCompare ? b[optionToCompare] : b;
      if (firstValue < secondValue) {
         return 1;
      }

      if (secondValue < firstValue) {
         return -1;
      }

      return 0;
   });
}

module.exports = {
   sortObject,
   getFirstDirInRelativePath,
   prettifyPath,
   unixifyPath,
   removeLeadingSlashes,
   promisifyDeferred,
   gzip,
   brotli,
   isEqualObjectFirstLevel,
   removeFileFromBuilderMeta,
   joinContents,
   componentCantBeParsed,
   descendingSort
};
