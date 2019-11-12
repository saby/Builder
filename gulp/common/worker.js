/**
 * Воркер для пула воркеров. Используется для сборки статики и сбора локализуемых фраз.
 * @author Бегунов Ал. В.
 */

/* eslint-disable no-console, global-require, no-inner-declarations */
'use strict';

/**
 * Trying to get worker's working directory.
 * If occurs an error, we will get working
 * directory from node.js main process cwd
 * stashed in workerpool environment
 * @returns {*}
 */
function checkCWDAvailability() {
   try {
      const currentDir = process.cwd();
      return currentDir;
   } catch (error) {
      console.log('cwd lost. Probably directory of current node.js process was removed.');
      return false;
   }
}

// не всегда понятно по 10 записям, откуда пришёл вызов.
Error.stackTraceLimit = 100;

if (!checkCWDAvailability()) {
   console.log('Changing worker\'s cwd to node.js main process cwd');
   process.chdir(process.env['main-process-cwd']);
}

// логгер - прежде всего
require('../../lib/logger').setWorkerLogger(process.env.logs);

const logger = require('../../lib/logger').logger();
function initializeWSForWorker() {
   const requiredModules = JSON.parse(process.env['required-modules']);

   // ws должен быть вызван раньше чем первый global.requirejs
   const nodeWS = require('./node-ws');
   nodeWS.init(requiredModules);
}

try {
   process.on('unhandledRejection', (reason, p) => {
      console.log(
         "[00:00:00] [ERROR] worker's critical error.",
         'Unhandled Rejection at:\n',
         p,
         '\nreason:\n',
         reason
      );
      process.exit(1);
   });

   /**
    * require данного набора функционала требует инициализации ядра
    * для работы. Поэтому обьявление данных функций выполняем только
    * в случае инициализации ядра.
    */
   let processingTmpl, prepareXHTMLPrimitive,
      buildXhtmlPrimitive, collectWordsPrimitive;

   const fs = require('fs-extra'),
      workerPool = require('workerpool'),
      { compileEsAndTs } = require('../../lib/compile-es-and-ts'),
      { buildLess } = require('../../lib/less/build-less'),
      buildNewLess = require('../../lib/less/build-new-less'),
      parseJsComponent = require('../../lib/parse-js-component'),
      processingRoutes = require('../../lib/processing-routes'),
      runMinifyCss = require('../../lib/run-minify-css'),
      runMinifyXhtmlAndHtml = require('../../lib/run-minify-xhtml-and-html'),
      minifyJs = require('../../lib/run-minify-js'),
      { wrapWorkerFunction } = require('./helpers'),
      { packLibrary } = require('../../lib/pack/library-packer'),
      { brotli, gzip } = require('../../lib/helpers');

   let componentsProperties;

   /**
    * Прочитать описание компонетов из json для локализации. Или взять прочитанное ранее.
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<Object>}
    */
   async function readComponentsProperties(componentsPropertiesFilePath) {
      if (!componentsProperties) {
         if (await fs.pathExists(componentsPropertiesFilePath)) {
            componentsProperties = await fs.readJSON(componentsPropertiesFilePath);
         } else {
            componentsProperties = {};
         }
      }
      return componentsProperties;
   }

   /**
    * Компиляция tmpl файлов
    * @param {string} text содержимое файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<{text, nodeName, dependencies}>}
    */
   async function buildTmpl(text, relativeFilePath, componentsPropertiesFilePath, templateExt) {
      if (!processingTmpl) {
         initializeWSForWorker();
         processingTmpl = require('../../lib/templates/processing-tmpl');
      }
      return processingTmpl.buildTmpl(
         processingTmpl.minifyTmpl(text),
         relativeFilePath,
         await readComponentsProperties(componentsPropertiesFilePath),
         templateExt
      );
   }

   /**
    * Компиляция html.tmpl файлов
    * @param {string} text содержимое файла
    * @param {string} fullPath полный путь до файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @param {boolean} isMultiService является ли проект мультисервисным
    * @param {string} servicesPath путь к текущему сервису
    * @returns {Promise<string>}
    */
   async function buildHtmlTmpl(
      text,
      fullPath,
      serviceConfig,
      relativeFilePath,
      componentsPropertiesFilePath
   ) {
      if (!processingTmpl) {
         initializeWSForWorker();
         processingTmpl = require('../../lib/templates/processing-tmpl');
      }
      return processingTmpl.buildHtmlTmpl(
         text,
         fullPath,
         serviceConfig,
         relativeFilePath,
         await readComponentsProperties(componentsPropertiesFilePath)
      );
   }

   /**
    * Для xhtml В XML формате расставляются скобки {[]} - аналог rk - для локализцемых фраз
    * (строки в разметке и переводимые опции).
    * @param {string} text содержимое файла
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<String>}
    */
   async function prepareXHTML(text, componentsPropertiesFilePath) {
      if (!prepareXHTMLPrimitive) {
         initializeWSForWorker();
         prepareXHTMLPrimitive = require('../../lib/i18n/prepare-xhtml');
      }
      return prepareXHTMLPrimitive(text, await readComponentsProperties(componentsPropertiesFilePath));
   }

   /**
    * Компиляция xhtml в js
    * @param {string} text содержимое файла
    * @param {string} relativeFilePath относительный путь до файла (начинается с имени модуля)
    * @returns {Promise<{nodeName, text}>}
    */
   async function buildXhtml(text, relativeFilePath) {
      if (!buildXhtmlPrimitive) {
         initializeWSForWorker();
         buildXhtmlPrimitive = require('../../lib/templates/processing-xhtml').buildXhtml;
      }
      return buildXhtmlPrimitive(await runMinifyXhtmlAndHtml(text), relativeFilePath);
   }

   /**
    * Сбор локализуемых фрах для конкретного файла
    * @param {string} modulePath путь до модуля
    * @param {string} filePath путь до файла
    * @param {string} componentsPropertiesFilePath путь до json-файла описания компонентов
    * @returns {Promise<string[]>}
    */
   async function collectWords(modulePath, filePath, componentsPropertiesFilePath) {
      if (!componentsProperties) {
         componentsProperties = await fs.readJSON(componentsPropertiesFilePath);
      }
      if (!collectWordsPrimitive) {
         initializeWSForWorker();
         collectWordsPrimitive = require('../../lib/i18n/collect-words');
      }
      const text = await fs.readFile(filePath);
      return collectWordsPrimitive(modulePath, filePath, text.toString(), componentsProperties);
   }

   /**
    * Get compressed in gzip and brotli data for current text
    * @param{String} data - source text
    * @returns {Promise<{brotli: *, gzip: *}>}
    */
   async function compress(data, buildBrotli) {
      // convert string to buffer. Brotli library can take only buffer as input.
      const dataBuffer = Buffer.from(data);
      const gzippedContent = await gzip(dataBuffer);
      let brotliContent;
      if (buildBrotli) {
         brotliContent = await brotli(dataBuffer);
      }
      return {
         gzip: gzippedContent,
         brotli: brotliContent
      };
   }

   workerPool.worker({
      parseJsComponent: wrapWorkerFunction(parseJsComponent),
      parseRoutes: wrapWorkerFunction(processingRoutes.parseRoutes),
      buildLess: wrapWorkerFunction(buildLess),
      buildNewLess: wrapWorkerFunction(buildNewLess),
      compileEsAndTs: wrapWorkerFunction(compileEsAndTs),
      buildTmpl: wrapWorkerFunction(buildTmpl),
      buildHtmlTmpl: wrapWorkerFunction(buildHtmlTmpl),
      prepareXHTML: wrapWorkerFunction(prepareXHTML),
      buildXhtml: wrapWorkerFunction(buildXhtml),
      minifyCss: wrapWorkerFunction(runMinifyCss),
      minifyXhtmlAndHtml: wrapWorkerFunction(runMinifyXhtmlAndHtml),
      minifyJs: wrapWorkerFunction(minifyJs),
      compress: wrapWorkerFunction(compress),
      collectWords: wrapWorkerFunction(collectWords),
      packLibrary: wrapWorkerFunction(packLibrary)
   });
} catch (workerInitError) {
   logger.error({
      message: 'Ошибка инициализации Worker\'а',
      error: workerInitError
   });
}
