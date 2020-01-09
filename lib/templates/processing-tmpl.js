'use strict';

const
   fs = require('fs-extra'),
   helpers = require('../helpers'),
   transliterate = require('../transliterate'),
   logger = require('../logger').logger(),
   promiseTimeout = require('../promise-with-timeout'),
   TemplatesBuilder = require('./templates-builder');

const templatesConfig = new TemplatesBuilder();
const numberOfRequiredDeps = 2;

const { requireJsSubstitutions } = require('../builder-constants');

const resolverControls = function resolverControls(path) {
   return `tmpl!${path}`;
};

async function generateFunction(html, fullPath, componentsProperties) {
   if (html.indexOf('define') === 0) {
      throw new Error(`${fullPath} - не шаблон`);
   }

   const conf = { config: templatesConfig.ViewConfig, filename: fullPath };
   const templateRender = Object.create(templatesConfig.ViewBuilderTmpl),
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

function getReactiveProps(ast, filePath) {
   let reactiveProps;

   /**
    * reactiveProps - свойства, используемые в шаблоне, мы делаем их реактивными.
    * Cохраним их в модуле, чтобы получить в конструкторе контрола.
    */
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
   templatesConfig.requireView();
   const prettyRelativeFilePath = helpers.removeLeadingSlashes(helpers.prettifyPath(relativeFilePath));
   const templateRender = Object.create(templatesConfig.ViewBuilderTmpl);
   const traversedObj = await parseTmpl(text, `resources/${prettyRelativeFilePath}`, componentsProperties);

   let resolvedNode = prettyRelativeFilePath.replace(/(\.tmpl|\.wml)$/g, '');
   for (const pair of requireJsSubstitutions) {
      if (resolvedNode.startsWith(pair[0])) {
         resolvedNode = resolvedNode.replace(pair[0], pair[1]);
         break;
      }
   }

   // resolvedNode может содержать пробелы. Нужен transliterate
   const currentNode = transliterate(resolvedNode);
   const templateName = `${templateExt}!${currentNode}`;

   /**
    * Build tmpl files with old methods, for new .wml templates will be
    * called "getFile" function from module "View/Builder/Tmpl"
    * Temporarily add "filename" and "fileName" options to provide backward
    * compatibility with template's processor functionality.
    */
   if (templateExt === 'wml') {
      return promiseTimeout.promiseWithTimeout(new Promise((resolve) => {
         templateRender.getFile(text, {
            config: templatesConfig.ViewConfig,
            filename: transliterate(resolvedNode),
            fileName: transliterate(resolvedNode),
            fromBuilderTmpl: true
         }, function callbackFn(funcText) {
            resolve({
               nodeName: `${templateName}`,
               dependencies: templateRender.getComponents(text),
               text: funcText
            });
         }, undefined, 'wml');
      }), 30000);
   }

   const tmplFunc = templateRender.func(traversedObj.astResult, {
      config: templatesConfig.ViewConfig,
      filename: transliterate(prettyRelativeFilePath),
      fromBuilderTmpl: true
   });

   let templateFunctionStr = `var templateFunction = ${tmplFunc.toString()};`;
   if (tmplFunc.includedFunctions) {
      templateFunctionStr += 'templateFunction.includedFunctions = {};';
   }

   const originalDeps = [...templateRender.getComponents(text)];
   const depsStr = originalDeps.reduce((accumulator, currentValue, index) => {
      const indexStr = (index + numberOfRequiredDeps).toString();
      return `${accumulator}_deps["${currentValue}"] = deps[${indexStr}];`;
   }, '');

   const resultDeps = ['View/Executor/TClosure', `i18n!${currentNode.split('/')[0]}`, ...originalDeps];

   /**
    * reactiveProps - свойства, используемые в шаблоне, мы делаем их реактивными.
    * Cохраним их в модуле, чтобы получить в конструкторе контрола.
    */
   const reactiveProps = getReactiveProps(traversedObj.astResult, relativeFilePath);

   return {
      nodeName: templateName,
      dependencies: originalDeps,
      text:
         `define('${templateName}',${JSON.stringify(resultDeps)},function(){` +
         'var deps=Array.prototype.slice.call(arguments);' +
         'var tclosure=deps[0];' +
         'var rk=deps[1];' +
         'var _deps = {};' +
         `${depsStr}` +
         `${templateFunctionStr}` +
         'templateFunction.stable = true;' +
         `templateFunction.toJSON = function() {return {$serialized$: "func", module: "${templateName}"}};` +
         `templateFunction.reactiveProps = ${reactiveProps};` +
         'return templateFunction;' +
         '});'
   };
}

async function buildHtmlTmpl(
   text,
   fullPath,
   serviceConfig,
   relativeFilePath,
   componentsProperties
) {
   templatesConfig.requireView();
   templatesConfig.setCommonRootInfo(serviceConfig);

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

   const result = await generateFunction(text, relativeFilePath, componentsProperties);
   const tmplFunc = result.tmplFunc.toString();

   return templatesConfig.render({
      builder: tmplFunc,
      preInitScript: cfg.preInitScript || '',
      builderCompatible: cfg.compatible,
      dependencies: result.dependencies.map(v => `'${v}'`).toString()
   });
}

async function parseTmpl(tmplMarkup, currentPath, componentsProperties) {
   templatesConfig.requireView();
   const tmplParserPromise = new Promise((resolve, reject) => {
      templatesConfig.ViewBuilderTmpl.template(tmplMarkup, resolverControls, {
         config: templatesConfig.ViewConfig,
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
