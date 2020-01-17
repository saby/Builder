/**
 * Паковщик библиотек. Используется в соответствующем Gulp-плагине сборщика:
 * builder/gulp/builder/plugins/pack-library.js
 * @author Колбешин Ф.А.
 */

'use strict';

const
   libPackHelpers = require('./helpers/librarypack'),
   escodegen = require('escodegen'),
   esprima = require('esprima'),
   path = require('path'),
   logger = require('../logger').logger(),
   pMap = require('p-map'),
   { traverse } = require('estraverse');

const invalidCharsForVariable = /\/|\?|!|-|\./g;

/**
 * Список нативных имён. Нельзя обьявлять алиасы при паковке библиотеки,
 * если алиас имеет имя нативной функции/переменной, мы можем перебить использование
 * нативной функции/переменной кастомным аналогом.
 * @type {string[]}
 */
const nativeJavascriptNames = ['fetch', 'Date', 'Object', 'Array', 'Number'];

function checkDependencyForExisting(dependencyName, privateDependenciesSet) {
   let existsInSet = false;
   privateDependenciesSet.forEach((dependency) => {
      if (dependency.moduleName === dependencyName) {
         existsInSet = true;
      }
   });
   return existsInSet;
}

function checkForExternalDep(dependency, libraryName) {
   const
      dependencyParts = dependency.split('/'),
      dependencyModule = dependencyParts[0].split(/!|\?/).pop(),
      libraryModule = libraryName.split('/')[0];

   return dependencyModule === libraryModule;
}

async function dependencyWalker(
   sourceRoot,
   libraryName,
   currentDepTree,
   parentDependency,
   currentDependency,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateModulesCache,
   privatePartsForCache,
   result,
   dependenciesTreeError
) {
   let newDepTree;

   /**
    * Приватные css-зависимости будем пока просить как внешние зависимости.
    * TODO спилить по выполнении задачи https://online.sbis.ru/opendoc.html?guid=0a57d162-b24c-4a9e-9bc2-bac22139b2ee
    * С плагином i18n та же история, нужно реализовать имитацию работы данного плагина на
    * паковщике библиотек.
    */
   if (currentDependency.startsWith('css!') || currentDependency.startsWith('i18n!')) {
      if (!externalDependenciesToPush.includes(currentDependency)) {
         externalDependenciesToPush.push(currentDependency);
      }

      return;
   }

   if (!checkForExternalDep(currentDependency, libraryName)) {
      logger.error(`attempt to load external private module: ${currentDependency}. Parent module: ${parentDependency}`);
      dependenciesTreeError.type = 'external private module';
      return;
   }
   if (!currentDepTree.has(currentDependency)) {
      const
         dependencyContent = await libPackHelpers.readModuleAndGetParamsNames(
            sourceRoot,
            libraryName,
            currentDependency,
            libraryDependenciesMeta,
            externalDependenciesToPush,
            privateModulesCache
         ),
         currentPrivateDependencies = dependencyContent.dependencies.filter((dep) => {
            if (dep === libraryName) {
               logger.error({
                  message: `Cycle library dependency. Parent module: ${currentDependency}`,
                  filePath: `${path.join(sourceRoot, libraryName)}.js`
               });
               dependenciesTreeError.type = 'cycle dependency';
            }
            return libPackHelpers.isPrivate(dep);
         });

      newDepTree = new Set([...currentDepTree, currentDependency]);
      if (
         !dependencyContent.externalDependency &&
         !checkDependencyForExisting(dependencyContent.moduleName, result)
      ) {
         result.add(dependencyContent);

         // добавляем в список на запись в кэш dependencies. Нужно для инкрементальной сборки
         privatePartsForCache.push(dependencyContent);
      }
      if (currentPrivateDependencies.length > 0) {
         await pMap(
            currentPrivateDependencies,
            async(childDependency) => {
               await dependencyWalker(
                  sourceRoot,
                  libraryName,
                  newDepTree,
                  currentDependency,
                  childDependency,
                  libraryDependenciesMeta,
                  externalDependenciesToPush,
                  privateModulesCache,
                  privatePartsForCache,
                  result,
                  dependenciesTreeError
               );
            },
            {
               concurrency: 10
            }
         );
      }
   } else {
      logger.error({
         message: `Cycle dependency detected: ${currentDependency}. Parent module: ${parentDependency}`,
         filePath: `${path.join(sourceRoot, libraryName)}.js`
      });
      dependenciesTreeError.type = 'cycle dependency';
   }
}

async function recursiveAnalizeEntry(
   sourceRoot,
   libraryName,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateDependencies,
   privateModulesCache,
   privatePartsForCache
) {
   const result = new Set();

   /**
    * Не будем ругаться через throw, просто проставим флаг.
    * Это позволит нам полностью проанализировать граф и сразу
    * выдать разработчикам все проблемные места.
    */
   const dependenciesTreeError = {};
   await pMap(
      privateDependencies,
      async(dependency) => {
         const currentTreeSet = new Set();
         await dependencyWalker(
            sourceRoot,
            libraryName,
            currentTreeSet,

            // parent module
            libraryName,

            // current dependency
            dependency,
            libraryDependenciesMeta,
            externalDependenciesToPush,
            privateModulesCache,
            privatePartsForCache,
            result,
            dependenciesTreeError
         );
      }
   );
   if (dependenciesTreeError.type === 'external private module') {
      throw new Error('external private module use detected. See logs.');
   }
   if (dependenciesTreeError.type === 'cycle dependency') {
      throw new Error('Cycle dependencies detected. See logs.');
   }
   return result;
}

/**
 * Получаем выражение для экспорта по конкретному имени экспортируемой переменной
 * в теле функции callback'а библиотеки, если такое существует.
 * @param{Array} elements
 * @param{String} valueName
 */
function getExportsIndexesByValueName(elements, valueName) {
   const result = [];
   elements.forEach((currentElement, index) => {
      if (currentElement.type !== 'ExpressionStatement') {
         return;
      }
      const currentExpression = currentElement.expression;
      if (!currentExpression.right || currentExpression.right.name !== valueName) {
         return;
      }

      if (
         !currentExpression.left ||
         !(currentExpression.left.object && currentExpression.left.object.name === 'exports')
      ) {
         return;
      }

      result.push(index);
   });
   return result;
}

/**
 * Removes global 'use strict' statement if exists.
 * Repairs first level return statement position if exists.
 * @param{Object} functionCallbackBody - AST tree of private module callback function
 * @param{Object} topLevelReturnStatement - return statement of current private module
 * @param{Object} exportsDefine - statement of exports property definition
 */
function removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement, exportsDefine) {
   if (escodegen.generate(functionCallbackBody.body[0]).includes('\'use strict\';')) {
      functionCallbackBody.body.splice(0, 1);
      if (topLevelReturnStatement) {
         topLevelReturnStatement.position--;
      }
      if (exportsDefine) {
         exportsDefine.position--;
      }
   }
}
async function packLibrary(sourceRoot, data, privateModulesCache) {
   const startTime = Date.now();
   const
      privatePartsForCache = [],
      ast = esprima.parse(data),
      {
         libraryDependencies,
         libraryDependenciesMeta,
         libraryParametersNames,
         functionCallbackBody,
         topLevelReturnStatement,
         exportsDefine,
         libraryName
      } = libPackHelpers.getLibraryMeta(ast),
      externalDependenciesToPush = [];

   const privateDependenciesSet = Object.keys(libraryDependenciesMeta).filter(
      dependency => libraryDependenciesMeta[dependency].isPrivate
   );

   /**
    * рекурсивно по дереву получаем полный набор приватных частей библиотеки,
    * от которых она зависит.
    * @type {Set<any>} в качестве результата нам будет возвращён Set
    */
   let privateDependenciesOrder = [...await recursiveAnalizeEntry(
      sourceRoot,
      libraryName,
      libraryDependenciesMeta,
      externalDependenciesToPush,
      privateDependenciesSet,
      privateModulesCache,
      privatePartsForCache
   )];

   /**
    * сортируем приватные модули между собой, наиболее зависимые от других приватных частей модули
    * будут обьявляться в самом конце, самые независимые вначале.
    */
   privateDependenciesOrder = libPackHelpers.sortPrivateModulesByDependencies(privateDependenciesOrder);

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
            const currentReturnExpressions = [];

            libPackHelpers.addExternalDepsToLibrary(
               externalDependenciesToPush,
               libraryDependencies,
               libraryDependenciesMeta,
               libraryParametersNames
            );

            let packIndex;
            if (exportsDefine.position) {
               removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement, exportsDefine);

               packIndex = exportsDefine.position + 1;

               if (topLevelReturnStatement) {
                  const returnArgument = topLevelReturnStatement.statement.argument;

                  /**
                   * надо проверить, что возвращается exports, иначе кидать ошибку.
                   */
                  if (escodegen.generate(returnArgument) !== 'exports') {
                     logger.error({
                        message: 'Библиотека в случае использования механизма exports должна возвращать в качестве результата именно exports',
                        filePath: `${path.join(sourceRoot, libraryName)}.js`
                     });
                  }
                  functionCallbackBody.body.splice(
                     topLevelReturnStatement.position,
                     1
                  );
               }
            } else {
               let exportsObject;

               packIndex = 0;
               removeStrictModeStatement(functionCallbackBody, topLevelReturnStatement);

               if (topLevelReturnStatement) {
                  const returnArgument = topLevelReturnStatement.statement.argument;
                  exportsObject = escodegen.generate(returnArgument);

                  /**
                   * в случае если возвращается последовательность операций, оборачиваем его
                   * и присваиваем exports результат выполнения этой последовательности операций
                   * Актуально для ts-конструкций вида "exports = {<перечисление экспортируемых свойств>}"
                   */
                  if (topLevelReturnStatement.returnsType === 'SequenceExpression') {
                     exportsObject = `(${exportsObject})`;
                  }

                  functionCallbackBody.body.splice(
                     topLevelReturnStatement.position,
                     1
                  );
               } else {
                  exportsObject = '{}';
               }
               currentReturnExpressions.push(`var exports = ${exportsObject};`);
            }

            privateDependenciesOrder.forEach((dep) => {
               const
                  argumentsForClosure = dep.dependencies
                     .map((dependency) => {
                        const currentDependencyName = dependency.replace(invalidCharsForVariable, '_');
                        libraryDependenciesMeta[dependency].names.push(`typeof ${currentDependencyName} === 'undefined' ? null : ${currentDependencyName}`);
                        if (libPackHelpers.isPrivate(dependency)) {
                           return `${libraryDependenciesMeta[dependency].names[0]}`;
                        }
                        return libraryDependenciesMeta[dependency].names[0];
                     });

               /**
                * Для каждой приватной части библиотеки обеспечиваем уникальность имени, поскольку
                * импорт 2х разных модулей может компилироваться для typescript в 1 переменную. Нам
                * нужно обеспечить уникальность имён для приватных частей библиотеки.
                */
               const currentDependencyName = dep.moduleName.replace(invalidCharsForVariable, '_');
               libraryDependenciesMeta[dep.moduleName].names.unshift(currentDependencyName);

               try {
                  functionCallbackBody.body.splice(
                     packIndex,
                     0,
                     esprima.parse(`exports['${dep.moduleName}'] = true;`)
                  );
                  packIndex++;
               } catch (error) {
                  const errorMessage = `Esprima error: cant parse Javascript code: exports['${dep.moduleName}'] = true;\n` +
                  `Error message: ${error.message} \n Stack: ${error.stack}`;
                  throw new Error(errorMessage);
               }

               // Проверяем зависимость на принадлежность к шаблонам, не вставлем use strict.
               const isTemplate = dep.moduleName.startsWith('tmpl!') || dep.moduleName.startsWith('wml!');

               const
                  moduleCode = `var ${currentDependencyName} = function(){ ${isTemplate ? '' : '"use strict";'} 
                     var exports = {};\nvar result =` +
                     `(${escodegen.generate(dep.ast)})(${argumentsForClosure});\n` +
                     'if (result instanceof Function) {\n' +
                     'return result;' +
                     '} else if (result && Object.getPrototypeOf(result) !== Object.prototype) {\n' +
                     'return result;' +
                     '} else {' +
                     'for (var property in result) {\n' +
                     'if (result.hasOwnProperty(property)) {\n' +
                     'exports[property] = result[property];\n' +
                     '}}\n' +
                     '}' +
                     'return exports;\n}();';

               try {
                  functionCallbackBody.body.splice(
                     packIndex,
                     0,
                     esprima.parse(moduleCode)
                  );
                  packIndex++;
               } catch (error) {
                  const errorMessage = `Esprima error: cant parse generated code for private library part: ${moduleCode}\n` +
                     `Error message: ${error.message} \n Stack: ${error.stack}`;
                  throw new Error(errorMessage);
               }
               let
                  libDependenciesList = libraryDependencies.map(dependency => dependency.value),
                  privateDependencyIndex = libDependenciesList.indexOf(dep.moduleName);

               /**
                * Одна приватная зависимость может быть заимпорчена несколько раз.
                * Например когда делается export нескольких сущностей из 1-го модуля.
                * Поэтому нам нужно вычистить также все найденные дубли.
                */
               while (privateDependencyIndex !== -1) {
                  const currentParameterName = libraryParametersNames[privateDependencyIndex] &&
                     libraryParametersNames[privateDependencyIndex].name;
                  const defaultParameterName = libraryDependenciesMeta[dep.moduleName].names[0];

                  /**
                   * если нашлись дополнительные дублирующие зависимости, то все переменные, с которыми она была
                   * передана в callback, делаем алиасами от самой первой переменной
                   */
                  if (
                     privateDependencyIndex < libraryParametersNames.length &&
                     currentParameterName !== defaultParameterName
                  ) {
                     if (nativeJavascriptNames.includes(libraryParametersNames[privateDependencyIndex].name)) {
                        const statementIndexes = getExportsIndexesByValueName(
                           functionCallbackBody.body,
                           libraryParametersNames[privateDependencyIndex].name
                        );
                        statementIndexes.forEach((currentIndex) => {
                           const [nameInLibrary] = libraryDependenciesMeta[dep.moduleName].names;
                           functionCallbackBody.body[currentIndex].expression.right.name = nameInLibrary;
                        });
                     } else {
                        const aliasCode = `var ${libraryParametersNames[privateDependencyIndex].name} = ${libraryDependenciesMeta[dep.moduleName].names[0]};`;
                        try {
                           functionCallbackBody.body.splice(
                              packIndex,
                              0,
                              esprima.parse(aliasCode)
                           );
                           packIndex++;
                        } catch (error) {
                           const errorMessage = `Esprima error: cant parse generated code for alias: ${aliasCode}\n` +
                              `Error message: ${error.message} \n Stack: ${error.stack}`;
                           throw new Error(errorMessage);
                        }
                     }
                  }

                  // удаляем приватную зависимость из зависимостей библиотеки и её передачу в callback
                  libPackHelpers.deletePrivateDepsFromList(
                     privateDependencyIndex,
                     libraryDependencies,
                     libraryParametersNames
                  );

                  // достаём свежий список зависимостей и аргументов
                  libDependenciesList = libraryDependencies.map(dependency => dependency.value);
                  privateDependencyIndex = libDependenciesList.indexOf(dep.moduleName);
               }
            });
            functionCallbackBody.body.push(esprima.parse(currentReturnExpressions.join('\n')));
            functionCallbackBody.body.push({
               'type': 'ReturnStatement',
               'argument': {
                  'type': 'Identifier',
                  'name': 'exports'
               }
            });
         }
      }
   });
   const libraryResult = {
      compiled: escodegen.generate(ast),
      newModuleDependencies: libraryDependencies.map(object => object.value),
      name: libraryName,
      passedTime: Date.now() - startTime
   };
   if (privatePartsForCache.length > 0) {
      libraryResult.fileDependencies = [];
      libraryResult.packedModules = [];
      privatePartsForCache.forEach((dependency) => {
         libraryResult.fileDependencies.push(
            getSourcePathByModuleName(sourceRoot, privateModulesCache, dependency.moduleName)
         );
         libraryResult.packedModules.push(dependency.moduleName);
         if (dependency.versioned) {
            libraryResult.versioned = true;
         }
         if (dependency.cdnLinked) {
            libraryResult.cdnLinked = true;
         }
      });
   }
   return libraryResult;
}

/**
 * Возвращает путь до исходного ES файла для анализируемой зависимости.
 * @param {string} sourceRoot - корень UI-исходников
 * @param {array<string>} privateModulesCache - кэш из taskParameters.cache для приватных модулей
 * @param {string} moduleName - имя анализируемой зависимости
 * @returns {string}
 */
function getSourcePathByModuleName(sourceRoot, privateModulesCache, moduleName) {
   let result = null;
   Object.keys(privateModulesCache).forEach((cacheName) => {
      if (privateModulesCache[cacheName].nodeName === moduleName) {
         result = cacheName;
      }
   });

   /**
    * если не нашли исходник для приватной зависимости в esModulesCache,
    * значит приватная зависимость - это js-модуль в ES5 формате.
    */
   if (!result) {
      result = `${path.join(sourceRoot, moduleName)}.js`;
   }
   return result;
}

module.exports = {
   packLibrary
};
