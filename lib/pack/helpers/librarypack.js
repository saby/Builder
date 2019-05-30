'use strict';

const
   esprima = require('esprima'),
   { traverse } = require('estraverse'),
   path = require('path'),
   fs = require('fs-extra'),
   helpers = require('../../helpers');

/**
 * Проверка модуля на соответствие всем требованиям приватных модулей.
 * @param{String} dependency - анализируемый модуль
 * @returns {boolean}
 */
function isPrivate(dependency) {
   let result = false;
   const dependencyParts = helpers.unixifyPath(dependency).split('/');

   // remove interface module name part from checking
   dependencyParts.shift();

   /**
    * remove module name, module can be private only if located
    * in folder with "_" prefix.
    * Modules with "_" prefix in name only are declared as public.
    */
   dependencyParts.pop();

   dependencyParts.forEach((part) => {
      if (part.startsWith('_')) {
         result = true;
      }
   });
   return result;
}

/**
 * Проверка кода библиотеки на наличие использования конструкции exports
 * @param{Object} functionCallBack - ast-дерево функции callback'а соответствующей библиотеки
 * @returns {{ position: (Number|null)}}
 */
function checkForDefineExportsProperty(functionCallBack) {
   const treeHasExportsDefine = {
      position: null
   };
   functionCallBack.body.forEach((node, index) => {
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
         treeHasExportsDefine.position = index;
      }
   });
   return treeHasExportsDefine;
}

/**
 * удаляем из зависимостей библиотеки и из аргументов функции callback'а
 * приватные части библиотеки, поскольку они обьявлены внутри callback'а.
 * @param{Number} privateDependencyIndex - расположение зависимости в общем списке
 * @param{Object} libraryDependencies - мета-данные всех зависимостей библиотеки и зависимостей
 * всех её приватных частей.
 * @param{Array} libraryParametersNames - массив аргументов функции callback'а библиотеки
 */
function deletePrivateDepsFromList(privateDependencyIndex, libraryDependencies, libraryParametersNames) {
   libraryDependencies.splice(
      privateDependencyIndex,
      1
   );
   if (privateDependencyIndex <= libraryParametersNames.length) {
      libraryParametersNames.splice(
         privateDependencyIndex,
         1
      );
   }
}

/**
 * Достаём из полученного ранее ast-дерева библиотеки набор данных,
 * необходимых для дальнейшей работы с библиотекой:
 * 1)libraryDependencies - набор зависимостей самой библиотеки
 * 2)libraryDependenciesMeta - мета-данные о каждой зависимости библиотеки
 * и всех других анализируемых модулях
 * 3)libraryParametersNames - набор зависимостей функции callback'а библиотеки
 * 4)functionCallbackBody - тело функции callback'а библиотеки в ast-формате.
 * 5)exportsDefine - используется ли конструкция exports в библиотеке
 * 6)topLevelReturnStatement - return верхнего уровня функции callback'а библиотеки
 * 7)libraryName - имя самой библиотеки

 * @param{Object} ast - ast-дерево анализируемой библиотеки
 * @returns{String} возвращает сгенерированный код библиотеки.
 */
function getLibraryMeta(ast) {
   const libraryMeta = {};
   traverse(ast, {
      enter(node) {
         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            const libraryDependenciesMeta = {};

            let dependencies, paramsNames, libraryName, returnStatement;

            node.arguments.forEach((argument) => {
               switch (argument.type) {
                  case 'ArrayExpression':
                     dependencies = argument.elements.map(element => element.value);
                     libraryMeta.libraryDependencies = argument.elements;
                     break;
                  case 'FunctionExpression':
                     paramsNames = argument.params.map(param => param.name);
                     dependencies.forEach((dependency) => {
                        const currentParamName = paramsNames[dependencies.indexOf(dependency)];
                        if (libraryDependenciesMeta.hasOwnProperty(dependency)) {
                           if (currentParamName) {
                              libraryDependenciesMeta[dependency].names.push(currentParamName);
                           }
                        } else {
                           libraryDependenciesMeta[dependency] = {
                              names: [currentParamName]
                           };
                        }
                        if (isPrivate(dependency)) {
                           libraryDependenciesMeta[dependency].isPrivate = true;
                        }
                     });
                     argument.body.body.forEach((expression, index) => {
                        if (expression.type === 'ReturnStatement') {
                           returnStatement = {
                              statement: expression,
                              position: index,
                              returnsType: expression.argument.type
                           };
                        }
                     });

                     libraryMeta.libraryParametersNames = argument.params;
                     libraryMeta.functionCallbackBody = argument.body;
                     libraryMeta.exportsDefine = checkForDefineExportsProperty(libraryMeta.functionCallbackBody);
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

            libraryMeta.libraryDependenciesMeta = libraryDependenciesMeta;
            libraryMeta.libraryName = libraryName;
            this.break();
         }
      }
   });
   return libraryMeta;
}

/**
 * Возвращает кэш из taskParameters.cache для конкретной анализируемой зависимости
 * @param privateModulesCache - кэш из taskParameters.cache для приватных модулей
 * @param moduleName - имя анализируемой зависимости
 * @returns {String}
 */
function getCacheByModuleName(privateModulesCache, moduleName) {
   let result = null;
   Object.keys(privateModulesCache).forEach((cacheName) => {
      const currentCache = privateModulesCache[cacheName];
      if (currentCache.nodeName === moduleName) {
         result = currentCache.text;
      }
   });
   return result;
}

/**
 * Убираем плагины require, чтобы в случае недоступности файла по данному плагину
 * в кэше мы могли прочитать исходный модуль из файловой системы
 */
function normalizeDependencyName(dependency) {
   if (dependency.startsWith('browser!')) {
      return dependency.replace('browser!', '');
   }
   return dependency;
}

/**
 *
 * @param{String} sourceRoot - путь до UI-исходников
 * @param{String} libraryName - имя анализируемой библиотеки
 * @param{String} currentDependency - текущая зависимость библиотеки
 * @param{Array} libraryDependenciesMeta - мета-данные зависимостей либы
 * @param{Array} externalDependenciesToPush - набор внешних зависимостей
 * приватных частей библиотеки, которые нам надо будет добавить в массив
 * зависимостей библиотеки
 * @returns {Promise<void>} - мета-данные приватной зависимости:
 * 1)ast - callback приватной зависимости в ast-формате
 * 2)dependencies - набор зависимостей приватного модуля
 * 3)moduleName - имя приватного модуля
 */
async function readModuleAndGetParamsNames(
   sourceRoot,
   libraryName,
   currentDependency,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateModulesCache
) {
   const normalizedCurrentDependency = normalizeDependencyName(currentDependency);
   let moduleData = getCacheByModuleName(privateModulesCache, normalizedCurrentDependency);

   /**
    * Если мы не смогли получить кэш, значит это приватный модуль в ES5 формате,
    * который не участвовал в компиляции es/ts, тогда его надо получить через fs
    */
   if (!moduleData) {
      moduleData = await fs.readFile(`${path.join(sourceRoot, normalizedCurrentDependency)}.js`, 'utf8');
   }

   const
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
         needToPushToLibraryDeps = !libraryDependenciesMeta.hasOwnProperty(dependency);

      if (!isPrivate(dependency) && needToPushToLibraryDeps) {
         externalDependenciesToPush.push(dependency);
      }
      if (needToPushToLibraryDeps) {
         libraryDependenciesMeta[dependency] = dependencyName ? {
            names: [dependencyName]
         } : {
            names: []
         };
      } else if (dependencyName) {
         libraryDependenciesMeta[dependency].names.push(dependencyName);
      }
   });

   return result;
}

/**
 * Функция для сортировки модулей по зависимостям. Если модуль A из пакета зависит от модуля B
 * из пакета, то модуль B должен быть определён до модуля A. Если встречается внешняя зависимость,
 * то это никак не влияет на модуль.
 * @param{Array} privateDependencies - набор приватных зависимостей библиотеки.
 * @returns {*}
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

/**
 * Проверяем передаваемое имя для зависимости на уникальность
 * в общем списке аргументов библиотеки:
 * 1) Если имя уникально, возвращаем его.
 * 2) Если имя дублируется:
 *    2.1)добавляем счётчик по аналогии с компиляцией typescript,
 *    проверяем на уникальность. Если ок, возвращаем. Если нет,
 *    увеличиваем счётчик.
 *    2.2)повторяем процедуру, пока не будет получено уникальное имя
 *    для переменной.
 */
function getUniqueParamName(paramName, libraryParametersNames, dependencyMeta) {
   const libraryParametersList = libraryParametersNames.map(param => param.name);

   if (libraryParametersList.includes(paramName)) {
      let
         counter = 1,
         newParamName,
         isUniqueName = false;
      while (!isUniqueName) {
         newParamName = `${paramName}_${counter}`;
         isUniqueName = !libraryParametersList.includes(newParamName);
         counter++;
      }

      // не забываем добавить
      dependencyMeta.names.unshift(newParamName);
      return newParamName;
   }
   return paramName;
}

/**
 * добавляем зависимости приватных частей библиотеки непосредственно
 * в зависимости самой библиотеки, если их самих ещё нет.
 * @param{Array} externalDependenciesToPush - набор внешних зависимостей, от которых зависимости
 * приватные модули библиотеки
 * @param{Array} libraryDependencies - набор зависимостей библиотеки.
 * @param{Object} libraryDependenciesMeta - мета-данные всех зависимостей библиотеки и зависимостей
 * всех её приватных частей.
 * @param{Array} libraryParametersNames - набор аргументов функции callback'а библиотеки
 */
function addExternalDepsToLibrary(
   externalDependenciesToPush,
   libraryDependencies,
   libraryDependenciesMeta,
   libraryParametersNames
) {
   externalDependenciesToPush.forEach((externalDependency) => {
      const paramName = libraryDependenciesMeta[externalDependency].names[0];
      const dependencyNameAst = {
         type: 'Literal',
         value: `${externalDependency}`,
         raw: `"${externalDependency}"`
      };
      if (paramName) {
         libraryDependencies.unshift(dependencyNameAst);
         libraryParametersNames.unshift({
            type: 'Identifier',
            name: `${getUniqueParamName(paramName, libraryParametersNames, libraryDependenciesMeta[externalDependency])}`
         });
      } else {
         libraryDependencies.push(dependencyNameAst);
      }
   });
}

module.exports = {
   getLibraryMeta,
   readModuleAndGetParamsNames,
   sortPrivateModulesByDependencies,
   addExternalDepsToLibrary,
   isPrivate,
   deletePrivateDepsFromList
};
