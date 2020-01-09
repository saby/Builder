/**
 * Основная библиотека по компиляции typescript исходника в
 * AMD-формате. Используется в соответствующем Gulp-плагине:
 * builder/gulp/builder/plugins/compile-es-and-ts.js
 * @author Колбешин Ф.А.
 */

'use strict';

const typescript = require('saby-typescript/lib/compiler'),
   path = require('path'),
   transliterate = require('../lib/transliterate'),
   helpers = require('../lib/helpers'),
   esprima = require('esprima'),
   { traverse } = require('estraverse'),
   modulePathToRequire = require('../lib/modulepath-to-require.js');

const privateModuleExt = /\.(es|ts|js)$/;
const excludeUrls = ['cdn', 'rtpackage', 'rtpack', 'demo_src'];
function checkForExcludedUrl(dependency) {
   let result = false;
   const normalizedDependency = helpers.removeLeadingSlashes(
      dependency.split(/!|\?/).pop()
   );
   excludeUrls.forEach((currentUrl) => {
      if (normalizedDependency.startsWith(currentUrl)) {
         result = true;
      }
   });
   return result;
}

/**
 * get typescript compiler options from saby typescript configuration
 */
const { compilerOptions } = require('saby-typescript/configs/es5.json');

function normalizeDependencies(sourceCode, moduleName, interfaceModule, startTime) {
   const ast = esprima.parse(sourceCode, { range: true });
   let normalizedModuleName = '';

   // list of relative dependencies to be formatted into AMD
   const modulesToReplace = [];
   let needToReplace = false;
   traverse(ast, {
      enter(node) {
         // узел непосредственно дефайна модуля
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            node.arguments.forEach((argument, index) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     for (let i = 0; i < argument.elements.length; i++) {
                        const dependency = argument.elements[i].value;

                        let newDependency = dependency;
                        if (privateModuleExt.test(newDependency) && !checkForExcludedUrl(newDependency)) {
                           newDependency = newDependency.replace(privateModuleExt, '');
                        }

                        if (newDependency.startsWith('.')) {
                           newDependency = helpers.unixifyPath(path.join(moduleName, '..', newDependency));
                        }

                        /**
                         * relative dependencies with plugin are not valid, for this dependencies must be selected
                         * full AMD-formatted module path
                         */
                        if (newDependency.includes('!.') || newDependency.includes('?.')) {
                           const errorMessage = 'relative dependencies with plugin are not valid. ' +
                            `Use full amd-module-name for this case! Bad dependency name: ${newDependency}`;
                           throw new Error(errorMessage);
                        }

                        // requirejs names normalizing is needed only for WS.Core dependencies
                        if (interfaceModule === 'WS.Core') {
                           newDependency = modulePathToRequire.getPrettyPath(newDependency);
                        }
                        if (newDependency !== dependency) {
                           needToReplace = true;
                           modulesToReplace.push({
                              name: `"${helpers.unixifyPath(newDependency)}"`,
                              start: argument.elements[i].range[0],
                              end: argument.elements[i].range[1]
                           });
                        }
                     }
                     break;
                  case 'Literal':
                     // ensure it's real interface module name, not Literal formatted callback
                     if (index === 0) {
                        // requirejs names normalizing is needed only for WS.Core compiled typescript content
                        if (interfaceModule === 'WS.Core') {
                           normalizedModuleName = modulePathToRequire.getPrettyPath(
                              helpers.unixifyPath(argument.value)
                           );
                        } else {
                           normalizedModuleName = helpers.unixifyPath(moduleName);
                        }
                        needToReplace = true;
                        modulesToReplace.unshift({
                           name: `"${normalizedModuleName}"`,
                           start: argument.range[0],
                           end: argument.range[1],
                        });
                     }
                     break;
                  default:
                     break;
               }
            });

            this.break();
         }
      }
   });
   let newCode = '';

   /**
    * if we have dependencies to be replaced, just build result code with this dependencies
    * using simple string concat, without AST code generators. Reason - AST code
    * generator loses typescript comments, or in 1 working case duplicates them.
     */
   if (needToReplace) {
      newCode += sourceCode.slice(0, modulesToReplace[0].start);

      for (let i = 0; i < modulesToReplace.length; i++) {
         newCode += modulesToReplace[i].name;
         newCode += sourceCode.slice(
            modulesToReplace[i].end,
            (modulesToReplace[i + 1] && modulesToReplace[i + 1].start) || ''
         );
      }
      newCode += sourceCode.slice(modulesToReplace[modulesToReplace.length - 1].end, sourceCode.length);
   }
   return {
      text: newCode || sourceCode,
      moduleName: normalizedModuleName,
      passedTime: Date.now() - startTime
   };
}

/**
 * Get transpile options in dependence on existing of
 * AMD-module construction(define)
 * @param {string} relativePath - relative path to current module. Starts from moduleName
 * @param {string} moduleName - AMD-formatted name of module
 * @param {string} moduleContent - typescript/ES6+ module content
 */
function getTranspileOptions(relativePath, moduleName, moduleContent) {
   const currentCompilerOptions = { ...compilerOptions };
   const defineRegEx = new RegExp(`define\\(['"]${moduleName.split(/\\|\//).shift()}`);

   // by default, typescript compiler uses CommonJs format for compiling typescript content
   if (defineRegEx.test(moduleContent) || relativePath.endsWith('.routes.ts')) {
      delete currentCompilerOptions.module;
   }
   return {
      compilerOptions: currentCompilerOptions,
      moduleName,
      fileName: relativePath
   };
}

/**
 * Compiles ES6+, TS modules into ES5
 * @param {string} relativePath - relative path to current module. Starts from moduleName
 * @param {string} text - typescript/ES6+ module content
 * @returns {Object}
 */
function compileEsAndTs(relativePath, text, interfaceModule) {
   const startTime = Date.now();
   const moduleName = transliterate(relativePath).replace(/\.(es|ts)$/, '');
   const transpileOptions = getTranspileOptions(relativePath, moduleName, text);
   const result = typescript.transpileModule(text, transpileOptions);
   return normalizeDependencies(result.outputText, moduleName, interfaceModule, startTime);
}

module.exports = {
   compileEsAndTs,
   getTranspileOptions
};
