/**
 * Плагин для кастомной паковки. Ищет файлы *.package.json, формирует пакеты согласно опциям в этих json.
 * @author Колбешин Ф.А.
 */

'use strict';
/* eslint-disable no-unused-vars */

const path = require('path'),
   through = require('through2'),
   packHelpers = require('../../../lib/pack/helpers/custompack'),
   customPacker = require('../../../lib/pack/custom-packer'),
   logger = require('../../../lib/logger').logger(),
   fs = require('fs-extra'),
   esprima = require('esprima'),
   pMap = require('p-map'),
   escodegen = require('escodegen'),
   { traverse, replace } = require('estraverse');

function getLibraryMeta(ast) {
   const libraryMeta = {};
   traverse(ast, {
      enter(node) {
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            const libraryDependencies = {};

            let dependencies, paramsNames, libraryName, returnStatement;

            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     dependencies = argument.elements.map(element => element.value);
                     break;
                  case 'FunctionExpression':
                     paramsNames = argument.params.map(param => param.name);
                     argument.body.body.forEach((expression, index) => {
                        if (expression.type === 'ReturnStatement') {
                           returnStatement = {
                              statement: expression,
                              position: index,
                              returnsType: expression.argument.type
                           };
                        }
                     });
                     if (returnStatement) {
                        libraryMeta.topLevelReturnStatement = returnStatement;
                     }
                     break;
                  case 'Literal':
                     libraryName = argument.value;
                     break;
                  default:
                     break;
               }
            });
            dependencies.forEach((dependency) => {
               const currentParamName = paramsNames[dependencies.indexOf(dependency)];
               if (libraryDependencies.hasOwnProperty(dependency)) {
                  if (currentParamName) {
                     libraryDependencies[dependency].names.push(currentParamName);
                  }
               } else {
                  libraryDependencies[dependency] = {
                     names: [currentParamName]
                  };
               }
            });
            libraryMeta.libraryDependencies = libraryDependencies;
            libraryMeta.libraryName = libraryName;
            this.break();
         }
      }
   });
   return libraryMeta;
}

function isPrivate(dependency) {
   let result = false;
   dependency.split('/').forEach((part) => {
      if (part.startsWith('_')) {
         result = true;
      }
   });
   return result;
}

function isInternalDependency(libDirectory, dependency) {
   return dependency.startsWith(libDirectory);
}

async function readModuleAndGetParamsNames(
   root,
   libraryName,
   currentDependency,
   libraryDependencies,
   externalDependenciesToPush
) {
   const
      modulePath = `${path.join(root, currentDependency)}.js`,
      moduleData = await fs.readFile(modulePath, 'utf8'),
      moduleAst = esprima.parse(moduleData),
      result = {};

   result.moduleName = currentDependency;
   let dependenciesNames;

   traverse(moduleAst, {
      enter(node) {
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     result.dependencies = argument.elements.map(element => element.value);
                     break;
                  case 'FunctionExpression':
                     dependenciesNames = argument.params.map(param => param.name);
                     result.ast = argument;
                     break;
                  default:
                     break;
               }
            });
            this.break();
         }
      }
   });

   result.dependencies.forEach((dependency) => {
      const
         dependencyName = dependenciesNames[result.dependencies.indexOf(dependency)],
         needToPushToLibraryDeps = !libraryDependencies.hasOwnProperty(dependency);

      if ((!isInternalDependency(path.dirname(libraryName), dependency) || !isPrivate(dependency)) &&
         needToPushToLibraryDeps) {
         externalDependenciesToPush.push(dependency);
      }
      if (needToPushToLibraryDeps) {
         libraryDependencies[dependency] = dependencyName ? {
            names: [dependencyName]
         } : {
            names: []
         };
      } else if (dependencyName) {
         libraryDependencies[dependency].names.push(dependencyName);
      }
   });

   return result;
}

/*
 * Функция для сортировки модулей по зависимостям. Если модуль A из
 * пакета зависит от модуля B из пакета, то модуль B должен быть
 * определён до модуля A, Если встречается внешняя зависимость, то это никак не влияет на модуль.
 */
function sortPrivateModulesByDependencies(privateDependencies) {
   privateDependencies.forEach((currentModule) => {
      function watcher(dependency, currentDepth, maxDepth) {
         const founded = privateDependencies.find(module => module.moduleName === dependency);
         let newMaxDepth = maxDepth;
         if (founded) {
            newMaxDepth += 1;
            if (founded.dependencies) {
               founded.dependencies.forEach((dep) => {
                  const depth = watcher(dep, currentDepth + 1, newMaxDepth);
                  newMaxDepth = depth > currentDepth ? depth : currentDepth;
               });
            }
         }
         return newMaxDepth;
      }

      currentModule.depth = 0;
      if (currentModule.dependencies) {
         currentModule.dependencies.forEach((dep) => {
            const maxDepth = watcher(dep, 0, 0);
            currentModule.depth = maxDepth > currentModule.depth ? maxDepth : currentModule.depth;
         });
      }
   });

   // непосредственно сама сортировка
   return privateDependencies.sort((a, b) => {
      if (a.depth > b.depth) {
         return 1;
      }
      if (a.depth < b.depth) {
         return -1;
      }
      return 0;
   });
}

function checkForDefineExportsProperty(ast) {
   let treeHasExportsDefine = false;
   traverse(ast, {
      enter(node) {
         const
            expressionCallee = node.expression && node.expression.callee,
            expressionArguments = node.expression && node.expression.arguments;

         if (node.type === 'ExpressionStatement' && expressionCallee &&

            // Object.defineProperty(exports, '__esModule', ...);
            (expressionCallee.object && expressionCallee.object.name === 'Object') &&
            (expressionCallee.property && expressionCallee.property.name === 'defineProperty') && expressionArguments &&
            (expressionArguments[0] && expressionArguments[0].name === 'exports') &&
            (expressionArguments[1] && expressionArguments[1].value === '__esModule')
         ) {
            treeHasExportsDefine = true;
            this.break();
         }
      }
   });
   return treeHasExportsDefine;
}

async function packCurrentLibrary(root, data) {
   const
      ast = esprima.parse(data),
      { libraryDependencies, libraryName, topLevelReturnStatement } = getLibraryMeta(ast),
      privateDependencies = Object.keys(libraryDependencies).filter(
         dependency => isPrivate(dependency) && isInternalDependency(path.dirname(libraryName), dependency)
      ),
      externalDependenciesToPush = [];

   let privateDependenciesOrder = [];

   /**
    * читаем все приватные модули, что импортирует к себе библиотека, и собираем для
    * дальнейшего использования метаданные - набор зависимостей, callback в формате ast
    * и имя самого приватного модуля.
    */
   await pMap(
      privateDependencies,
      async(dependency) => {
         const result = await readModuleAndGetParamsNames(
            root,
            libraryName,
            dependency,
            libraryDependencies,
            externalDependenciesToPush
         );
         if (result) {
            privateDependenciesOrder.push(result);
         }
      },
      {
         concurrency: 10
      }
   );

   /**
    * сортируем приватные модули между собой, наиболее зависимые от других приватных частей модули
    * будут обьявляться в самом конце, самые независимые вначале.
    */
   privateDependenciesOrder = sortPrivateModulesByDependencies(privateDependenciesOrder);

   /**
    * производим непосредственно сами манипуляции с библиотекой:
    * 1) Добавляем в зависимости библиотеки внешние зависимости приватных частей библиотеки, если их нет в списке.
    * 2) Выкидываем из зависимостей библиотеки все приватные её части, уменьшая таким образом Стэк requirejs.
    * 3) Обьявляем сами приватные части библиотеки внутри неё и экспортируем наружу вместе с исходным экспортируемым
    * библиотекой объектом.
    */
   traverse(ast, {
      enter(node) {
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            let dependencies, paramsNames, functionCallbackBody;

            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     dependencies = argument.elements;
                     break;
                  case 'FunctionExpression':
                     paramsNames = argument.params;
                     functionCallbackBody = argument.body;
                     break;
                  default:
                     break;
               }
            });

            /**
             * добавляем зависимости приватных частей библиотеки непосредственно
             * в зависимости самой библиотеки, если их самих ещё нет.
             */
            externalDependenciesToPush.forEach((externalDependency) => {
               if (libraryDependencies[externalDependency].names[0]) {
                  dependencies.unshift({
                     type: 'Literal',
                     value: `${externalDependency}`,
                     raw: `"${externalDependency}"`
                  });
                  paramsNames.unshift({
                     type: 'Identifier',
                     name: `${libraryDependencies[externalDependency].names[0]}`
                  });
               }
            });

            privateDependenciesOrder.forEach((dep) => {
               const
                  argumentsForClosure = dep.dependencies
                     .filter((element, index) => (index <= dep.ast.params.length))
                     .map((dependency) => {
                        if (isPrivate(dependency) && isInternalDependency(path.dirname(libraryName), dependency)) {
                           return `exports.${libraryDependencies[dependency].names[0]}`;
                        }
                        return libraryDependencies[dependency].names[0];
                     }),
                  [currentDependencyName] = libraryDependencies[dep.moduleName].names,
                  privateDependencyIndex = dependencies.indexOf(dep.moduleName),
                  moduleCode = `exports.${currentDependencyName}=(${escodegen.generate(dep.ast)})(${argumentsForClosure})`;

               /**
                * удаляем из зависимостей библиотеки и из аргументов функции callback'а
                * приватные части библиотеки, поскольку они обьявлены внутри callback'а
                * и экспортируются наружу как и планировалось.
                */
               dependencies.splice(
                  privateDependencyIndex,
                  1
               );
               if (privateDependencyIndex <= paramsNames.length) {
                  paramsNames.splice(
                     privateDependencyIndex,
                     1
                  );
               }

               functionCallbackBody.body.splice(
                  topLevelReturnStatement.position,
                  0,
                  esprima.parse(moduleCode)
               );
               topLevelReturnStatement.position++;
            });
         }
      }
   });
   return escodegen.generate(ast);
}

/**
 * Объявление плагина
 * @param {BuildConfiguration} config конфигурация сборки
 * @param {DependencyGraph} depsTree граф зависимостей
 * @param {{bundles:{}, bundlesRoute:{}}} results результаты паковки для конкретного конфига
 * @param {string} root корень развернутого приложения
 * @returns {*}
 */
module.exports = function generatePackageJson(config, depsTree, results, root) {
   return through.obj(async function onTransform(file, encoding, callback) {
      let currentConfig;
      if (file.path.includes('WS.Data')) {
         const
            libraryRoot = path.join(root, 'WS.Data/Data/Type.js'),
            data = await fs.readFile(libraryRoot, 'utf8');

         await fs.writeFile(path.join(root, 'test2.js'), await packCurrentLibrary(root, data));
      }
      try {
         currentConfig = JSON.parse(file.contents);
      } catch (err) {
         logger.error({
            message: 'Ошибка парсинга конфигурации для кастомного пакета',
            filePath: file.path
         });
      }
      const configsArray = packHelpers.getConfigsFromPackageJson(
         file.path.replace(path.normalize(`${root}/`), ''),
         root,
         currentConfig
      );
      const currentResult = await customPacker.generatePackageJsonConfigs(
         depsTree,
         configsArray,
         root,

         // application
         '/',

         // splittedCore
         true,

         // isGulp
         true,
         config.localizations
      );

      packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundles');
      packHelpers.appendBundlesOptionsToCommon(currentResult, results, 'bundlesRoute');
      callback();
   });
};
/* eslint-enable no-unused-vars */
