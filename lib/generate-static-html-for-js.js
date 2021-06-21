'use strict';
const path = require('path'),
   fs = require('fs-extra'),
   logger = require('../lib/logger').logger(),
   helpers = require('../lib/helpers');

// регулярки для замены в статических html
const INCLUDE = /%{INCLUDE\s(?:["'])([^'"]*)(?:["'])\s?}/g,
   WINDOW_TITLE = /%{WINDOW_TITLE}/g,
   APPEND_STYLE = /%{APPEND_STYLE}/g,
   APPEND_JAVASCRIPT = /%{APPEND_JAVASCRIPT}/g,
   ACCESS_LIST = /%{ACCESS_LIST}/g,
   APPLICATION_ROOT = /%{APPLICATION_ROOT}/g,
   CDN_ROOT = /%{CDN_ROOT}/g,
   SBIS_ROOT = /%{WI\.SBIS_ROOT}/g,
   RESOURCE_ROOT = /%{RESOURCE_ROOT}/g,
   SERVICES_PATH = /%{SERVICES_PATH}/g,
   SAVE_LAST_STATE = /%{SAVE_LAST_STATE}/g,
   START_DIALOG = /%{START_DIALOG(.*)}/g;

const dblSlashes = /\\/g;

// кеш для хранения обработанных html-шаблонов с развёрнутыми includes
const cache = {};

// рекурсивный и ассинхронный обход html-шаблонов.
// результат с развёрнутыми INCLUDE положим в cache
function loadFileAndReplaceIncludes(filePath, modules, moduleInfo) {
   const prettyFilePath = helpers.prettifyPath(filePath);
   return new Promise((resolve, reject) => {
      if (cache.hasOwnProperty(prettyFilePath)) {
         resolve(cache[prettyFilePath]);
      } else {
         fs.readFile(prettyFilePath, async(err, text) => {
            if (err) {
               reject(err);
            } else {
               try {
                  cache[prettyFilePath] = await replaceIncludes(text.toString(), modules, moduleInfo);
                  resolve(cache[prettyFilePath]);
               } catch (error) {
                  error.message = `Ошибка при обработке файла ${prettyFilePath}: ${error.message.replace(
                     dblSlashes,
                     '/'
                  )}`;
                  reject(error);
               }
            }
         });
      }
   });
}

/**
 * Check current dependency for existance in current Interface module
 * dependencies list. If it's new dependency not existing in current module s3mod
 * dependencies list, log it as error.
 * @param{String} moduleName - current dependency interface module name
 * @param{Object} moduleInfo - interface module info for current html
 * @returns {boolean}
 */
function checkForExternalInterfaceModule(moduleName, moduleInfo) {
   return !(moduleName === moduleInfo.name || moduleInfo.depends.includes(moduleName));
}

function findFileInModules(relativePath, modules, moduleInfo) {
   const moduleName = helpers.getFirstDirInRelativePath(relativePath);

   /**
    * check for external interface module usage without dependency in current s3mod file.
    */
   const checkResult = checkForExternalInterfaceModule(moduleName, moduleInfo);
   if (checkResult) {
      logger.warning({
         message: `External Interface module "${moduleName}" usage(old webpage html). Check for it existance in "${moduleInfo.name}" interface module dependencies`,
         moduleInfo
      });
   }
   if (modules.has(moduleName)) {
      return path.join(path.dirname(modules.get(moduleName)), relativePath);
   }
   throw new Error(`Не удалось найти модуль '${moduleName}' в проекте`);
}

async function replaceIncludes(text, modules, moduleInfo) {
   let newText = text;
   const replaceMapIncludes = new Map(),
      promisesLoadFiles = [];
   let result = INCLUDE.exec(newText);
   while (result) {
      const file = findFileInModules(result[1], modules, moduleInfo);
      promisesLoadFiles.push(loadFileAndReplaceIncludes(file, modules, moduleInfo));
      replaceMapIncludes.set(result[0], file);
      result = INCLUDE.exec(newText);
   }

   // ждём пока все используемые html шаблоны попадут в cache
   await Promise.all(promisesLoadFiles);

   replaceMapIncludes.forEach((value, key) => {
      newText = newText.replace(key, cache[helpers.prettifyPath(value)]);
   });
   return newText;
}

function replaceConstant(text, componentInfo, config, replacePath) {
   let newText = text;
   try {
      if (replacePath) {
         // сервис представлений сам установит эти переменные.
         // нужно подставлять переменные если:
         // -используется препроцессор
         // -не используется ни препроцессор, ни сервис представлений
         newText = newText.replace(APPLICATION_ROOT, config.urlServicePath);
         newText = newText.replace(SBIS_ROOT, config.urlServicePath + config.wsPath);
         newText = newText.replace(RESOURCE_ROOT, config.resourcesUrl ? `${config.urlServicePath}resources/` : config.urlServicePath);
         newText = newText.replace(SERVICES_PATH, `${config.urlDefaultServicePath}service/`);
         newText = newText.replace(CDN_ROOT, '/cdn/');
      }
      newText = newText.replace(WINDOW_TITLE, componentInfo.webPage.title || '');
      newText = newText.replace(APPEND_STYLE, '');
      newText = newText.replace(APPEND_JAVASCRIPT, '');
      newText = newText.replace(ACCESS_LIST, '');
      newText = newText.replace(SAVE_LAST_STATE, false);
      newText = newText.replace(START_DIALOG, componentInfo.componentName);
   } catch (err) {
      logger.error({
         error: err
      });
   }
   return newText;
}

async function generateStaticHtmlForJs(file, componentInfo, moduleInfo, config, modules, replacePath) {
   const needGenerateHtml =
      componentInfo.hasOwnProperty('webPage') &&
      componentInfo.webPage.hasOwnProperty('outFileName') &&
      componentInfo.webPage.outFileName &&
      componentInfo.webPage.outFileName.trim();

   if (!needGenerateHtml) {
      return null;
   }

   if (!moduleInfo.contents.hasOwnProperty('htmlNames')) {
      moduleInfo.contents.htmlNames = {};
   }

   const { componentName, webPage } = componentInfo;
   const htmlTemplate = (webPage.htmlTemplate || '').replace(dblSlashes, '/');
   const outFileName = `${webPage.outFileName}.html`;

   if (!componentName) {
      throw new Error('Не указано имя компонента');
   }

   if (!htmlTemplate) {
      throw new Error('Не указан шаблон');
   }
   const templatePath = findFileInModules(htmlTemplate, modules, moduleInfo);

   if (outFileName.includes('/') || outFileName.includes('\\')) {
      logger.warning({
         message: 'В webPage.outFileName не должно быть относительных путей',
         filePath: file
      });
   }

   let result;
   if (templatePath) {
      if (outFileName.includes('/') || outFileName.includes('\\')) {
         logger.warning({
            message: 'В webPage.outFileName не должно быть относительных путей',
            filePath: file
         });
      }

      const text = await loadFileAndReplaceIncludes(templatePath, modules, moduleInfo);
      result = {
         outFileName,
         text: replaceConstant(text, componentInfo, config, replacePath)
      };

      moduleInfo.contents.htmlNames[componentName] = outFileName;
      if (componentInfo.webPage.hasOwnProperty('urls')) {
         result.urls = componentInfo.webPage.urls;
      }
   }
   return result;
}

module.exports = generateStaticHtmlForJs;
