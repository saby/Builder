'use strict';

const fs = require('fs-extra');

const helpers = require('../lib/helpers'),
   transliterate = require('../lib/transliterate'),
   logger = require('../lib/logger').logger(),
   promiseTimeout = require('../lib/promise-with-timeout');

let tmplControlsApplicationRoute = null,
   ViewBuilderTmpl = null,
   ViewConfig = null;

// замены, которые нужны для поддержки ядра WS.
// костыль в /ws/ext/requirejs/config.js
const requireJsSubstitutions = new Map([

   // splittedCore == true
   ['WS.Core/lib/', 'Lib/'],
   ['WS.Core/core/', 'Core/'],
   ['WS.Deprecated/', 'Deprecated/'],

   // splittedCore == false
   ['ws/lib/', 'Lib/'],
   ['ws/core/', 'Core/'],
   ['ws/deprecated/', 'Deprecated/']
]);

const resolverControls = function resolverControls(path) {
   return `tmpl!${path}`;
};

async function generateFunction(html, fullPath, componentsProperties) {
   if (html.indexOf('define') === 0) {
      throw new Error(`${fullPath} - не шаблон`);
   }

   const conf = { config: ViewConfig, filename: fullPath };
   const templateRender = Object.create(ViewBuilderTmpl),
      dependencies = [];

   templateRender.getComponents(html).forEach((dep) => {
      dependencies.push(dep);
   });

   // строю ast-дерево
   const traversedObj = await parseTmpl(html, fullPath, componentsProperties);

   const traversed = traversedObj.astResult;

   // строю функцию по ast-дереву
   const tmplFunc = templateRender.func(traversed, conf);
   return {
      dependencies,
      tmplFunc
   };
}

/**
 * Загружаем набор необходимых зависимостей из View, если это необходимо.
 * Необходимо при компиляции *.html.tmpl, *.tmpl
 */
function requireViewIfNeeded() {
// не во всех проектах есть *.tmpl, не нужно в этих случаях падать, если нет модуля View.
   if (!ViewBuilderTmpl) {
      ViewBuilderTmpl = global.requirejs('View/Builder/Tmpl');
   }
   if (!ViewConfig) {
      ViewConfig = global.requirejs('View/config');
   }
}
function getReactiveProps(ast, filePath) {
   let reactiveProps;
   // reactiveProps - свойства, используемые в шаблоне, мы делаем их реактивными. сохраним их в модуле, чтобы получить в конструкторе контрола.
   if (ast.reactiveProps) {
      if (Array.isArray(ast.reactiveProps)) {
         reactiveProps = JSON.stringify(ast.reactiveProps);
      } else {
         logger.error({
            message: 'buildTmpl error: reactiveProps must be array!',
            filePath
         });
         reactiveProps = '[]';
      }
   } else {
      reactiveProps = '[]';
   }
   return reactiveProps;
}

// relativeFilePath должен начинаться с имени модуля
async function buildTmpl(text, relativeFilePath, componentsProperties, templateExt) {
   requireViewIfNeeded();
   const prettyRelativeFilePath = helpers.removeLeadingSlash(helpers.prettifyPath(relativeFilePath));
   const templateRender = Object.create(ViewBuilderTmpl);
   const traversedObj = await parseTmpl(text, `resources/${prettyRelativeFilePath}`, componentsProperties);

   let resolvedNode = prettyRelativeFilePath.replace(/(\.tmpl|\.wml)$/g, '');
   for (const pair of requireJsSubstitutions) {
      if (resolvedNode.startsWith(pair[0])) {
         resolvedNode = resolvedNode.replace(pair[0], pair[1]);
         break;
      }
   }

   // resolvedNode может содержать пробелы. Нужен transliterate
   const currentNode = transliterate(`${templateExt}!${resolvedNode}`);

   /**
    * вызываем функцию getFile модуля View/Builder/Tmpl только для wml
    * шаблонов, для tmpl билдим по старому
    */
   if (templateExt === 'wml') {
      return promiseTimeout.promiseWithTimeout(new Promise((resolve) => {
         templateRender.getFile(text, {
            config: ViewConfig,
            fileName: transliterate(resolvedNode),
            fromBuilderTmpl: true
         }, function callbackFn(funcText) {
            resolve({
               nodeName: `${currentNode}`,
               dependencies: templateRender.getComponents(text),
               text: funcText
            });
         }, undefined, 'wml');
      }), 30000);
   }

   const tmplFunc = templateRender.func(traversedObj.astResult, {
      config: ViewConfig,
      filename: `resources/${prettyRelativeFilePath}`,
      fromBuilderTmpl: true
   });

   let templateFunctionStr = `var templateFunction = ${tmplFunc.toString()};`;
   if (tmplFunc.includedFunctions) {
      templateFunctionStr += 'templateFunction.includedFunctions = {};';
   }

   const originalDeps = [...templateRender.getComponents(text)];
   const depsStr = originalDeps.reduce((accumulator, currentValue, index) => {
      const indexStr = (index + 1).toString();
      return `${accumulator}_deps["${currentValue}"] = deps[${indexStr}];`;
   }, '');

   const resultDeps = ['View/Executor/TClosure', ...originalDeps];

   // reactiveProps - свойства, используемые в шаблоне, мы делаем их реактивными. сохраним их в модуле, чтобы получить в конструкторе контрола.
   const reactiveProps = getReactiveProps(traversedObj.astResult, relativeFilePath);

   return {
      nodeName: currentNode,
      dependencies: originalDeps,
      text:
         `define('${currentNode}',${JSON.stringify(resultDeps)},function(){` +
         'var deps=Array.prototype.slice.call(arguments);' +
         'var tclosure=deps[0];' +
         'var _deps = {};' +
         `${depsStr}` +
         `${templateFunctionStr}` +
         'templateFunction.stable = true;' +
         `templateFunction.toJSON = function() {return {$serialized$: "func", module: "${currentNode}"}};` +
         `templateFunction.reactiveProps = ${reactiveProps} ` +
         'return templateFunction;' +
         '});'
   };
}

async function buildHtmlTmpl(
   text,
   fullPath,
   relativeFilePath,
   componentsProperties,
   isMultiService,
   servicesPath
) {
   requireViewIfNeeded();

   // не во всех проектах есть *.html.tmpl, не нужно в этих случаях падать, если нет модуля Controls.
   if (!tmplControlsApplicationRoute) {
      logger.debug('Require Controls/Application');

      /* Иногда Controls/Application/Core даже не начинает строиться внутри Route,
       * никаких логов нет, видимо потому что они остаются в таймаутах require.js
       * */

      const coreApp = global.requirejs('Controls/Application/Core');
      if (!coreApp) {
         logger.error({
            message: 'Ошибка при запуске html.tmpl. Не загрузился модуль Controls/Application/Core'
         });
      }

      global.requirejs('Controls/Application');
      tmplControlsApplicationRoute = global.requirejs('wml!Controls/Application/Route');
   }

   let cfg = {};
   const cfgPath = fullPath.replace(/\.html\.tmpl$/, '.html.cfg');
   if (await fs.pathExists(cfgPath)) {
      try {
         cfg = await fs.readJson(cfgPath);
      } catch (error) {
         logger.error({
            message: 'Ошибка при обработке конфигурации шаблона',
            error,
            filePath: cfgPath
         });
      }
   }

   // Если используется сервис представлений, вместо конкретных путей указываем
   // плэйсхолдеры. Они будут заменены сервисом представлений
   const replacedAppRoot = isMultiService ? '%{APPLICATION_ROOT}' : '/';
   const replacedWsRoot = isMultiService ? '%{WI.SBIS_ROOT}' : '/resources/WS.Core/';
   const replacedResourceRoot = isMultiService ? '%{RESOURCE_ROOT}' : '/resources/';
   const replacedServicesPath = isMultiService ? '%{SERVICES_PATH}' : servicesPath;

   const result = await generateFunction(text, relativeFilePath, componentsProperties);
   const tmplFunc = result.tmplFunc.toString();

   const routeResult = tmplControlsApplicationRoute({
      application: 'Controls/Application',
      appRoot: replacedAppRoot,
      wsRoot: replacedWsRoot,
      resourceRoot: replacedResourceRoot,
      servicesPath: replacedServicesPath,
      _options: {
         builder: tmplFunc,
         preInitScript: cfg.preInitScript || '',
         builderCompatible: cfg.compatible,
         dependencies: result.dependencies.map(v => `'${v}'`).toString()
      }
   });

   if (typeof routeResult === 'string') {
      return routeResult;
   }
   return helpers.promisifyDeferred(routeResult);
}

async function parseTmpl(tmplMarkup, currentPath, componentsProperties) {
   requireViewIfNeeded();
   const tmplParserPromise = new Promise((resolve, reject) => {
      ViewBuilderTmpl.template(tmplMarkup, resolverControls, {
         config: ViewConfig,
         filename: currentPath,
         fromBuilderTmpl: true,
         createResultDictionary: true,
         componentsProperties
      }).handle(
         (traversedObj) => {
            resolve(traversedObj);
         },
         (error) => {
            reject(error);
         }
      );
   });
   try {
      return await promiseTimeout.promiseWithTimeout(tmplParserPromise, 30000);
   } catch (err) {
      if (err instanceof promiseTimeout.TimeoutError) {
         const error = new promiseTimeout.TimeoutError(
            "Unhandled exception from 'View/Builder/Tmpl/traverse'! See logs in builder-build-resources!"
         );

         // TODO вернуть уровень error, когда будет однозначно понятно, из за какого шаблона свалилось по таймауту.
         logger.warning({
            error,
            filePath: currentPath,
            message: 'Critical ERROR!'
         });
         throw error;
      }
      throw err;
   }
}

function minifyTmpl(text) {
   const str = text.replace(/<![ \r\n\t]*(--([^-]|[\r\n]|-[^-])*--[ \r\n\t]*)>/g, '');
   return str.replace(/>\s{0}</g, '><');
}

module.exports = {
   buildTmpl,
   buildHtmlTmpl,
   parseTmpl,
   minifyTmpl
};
