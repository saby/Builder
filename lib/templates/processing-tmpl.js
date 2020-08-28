'use strict';

const
   fs = require('fs-extra'),
   helpers = require('../helpers'),
   transliterate = require('../transliterate'),
   logger = require('../logger').logger(),
   promiseTimeout = require('../promise-with-timeout'),
   TemplatesBuilder = require('./templates-builder');

const templatesConfig = new TemplatesBuilder();

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

// relativeFilePath должен начинаться с имени модуля
async function buildTemplate(text, relativeFilePath, componentsProperties, generateCodeForTranslations) {
   templatesConfig.requireView();
   const prettyRelativeFilePath = helpers.removeLeadingSlashes(helpers.prettifyPath(relativeFilePath));
   const compiler = new templatesConfig.Compiler();
   const xhtmlCompiler = templatesConfig.XhtmlCompiler;
   const config = {
      fileName: transliterate(prettyRelativeFilePath),
      fromBuilderTmpl: true,
      createResultDictionary: true,
      componentsProperties,
      generateCodeForTranslations
   };
   try {
      let result;
      if (prettyRelativeFilePath.endsWith('.xhtml')) {
         result = await xhtmlCompiler.compileXhtml(text, config);
      } else {
         result = await compiler.compile(text, config);
      }
      result.config = config;
      return result;
   } catch (resultWithErrors) {
      /**
       * worker can't pass array of instances of Error through itself, so we need to stringify them
       * before transmit them out of the worker to main gulp process.
        */
      const normalizedErrorsList = resultWithErrors.errors.map(
         error => error.toString().replace(/(\r)?\n/g, ' ')
      ).join(';');
      throw new Error(normalizedErrorsList);
   }
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

   const filePath = transliterate(relativeFilePath);
   const result = await generateFunction(text, filePath, componentsProperties);
   const tmplFunc = result.tmplFunc.toString();

   if (relativeFilePath) {
      result.dependencies.push(`i18n!${filePath.split('/')[0]}`);
   }

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
   buildTemplate,
   buildHtmlTmpl,
   parseTmpl,
   minifyTmpl
};
