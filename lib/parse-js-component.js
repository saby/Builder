'use strict';

const esprima = require('esprima'),
   { traverse } = require('estraverse'),
   defaultCatchAst = require('../resources/error-callback-ast'),
   escodegen = require('escodegen');

const { isPrivate } = require('./pack/helpers/librarypack');

const NAME_NAVIGATION = /(optional!)?(js!SBIS3\.NavigationController|Navigation\/NavigationController)$/;

function findExpression(node, left) {
   return (
      node.type === 'ExpressionStatement' &&
      node.expression &&
      node.expression.type === 'AssignmentExpression' &&
      node.expression.operator === '=' &&
      node.expression.left.type === 'MemberExpression' &&
      node.expression.left.property.name === left &&
      node.expression.left.object &&
      node.expression.left.object.type === 'Identifier'
   );
}

function parseObjectExpression(properties) {
   const obj = {};
   properties.forEach((prop) => {
      if (prop.value.type === 'ArrayExpression') {
         obj[prop.key.name] = [];
         for (const element of prop.value.elements) {
            obj[prop.key.name].push(element.value);
         }
      } else {
         obj[prop.key.name] = prop.value.value;
      }
   });
   return obj;
}

function getLessPropertyInObject(node) {
   // check node for object statement
   if (node.type !== 'ObjectExpression' && !node.properties) {
      return '';
   }

   const componentLess = new Set();
   node.properties.forEach((currentProperty) => {
      if (!(currentProperty.key && currentProperty.key.name)) {
         return;
      }

      // assignable value should be an Array only
      if (!(currentProperty.value && currentProperty.value.type === 'ArrayExpression')) {
         return;
      }
      if (currentProperty.key.name === '_theme' || currentProperty.key.name === '_styles') {
         currentProperty.value.elements.forEach((currentElement) => {
            componentLess.add(currentElement.value);
         });
      }
   });
   return componentLess;
}

function getLessPropertyInAssignment(node) {
   // check node for assignment statement
   if (
      node.type !== 'AssignmentExpression' ||
      !(node.left && node.left.property && node.left.property.name)
   ) {
      return '';
   }

   // check for needed property name
   const propertyName = node.left.property.name;
   if (!(propertyName === '_theme' || propertyName === '_styles')) {
      return '';
   }

   // assignable value should be an Array only
   if (node.right.type !== 'ArrayExpression') {
      return '';
   }

   const componentLess = new Set();
   node.right.elements.forEach((currentElement) => {
      if (currentElement.type !== 'Literal') {
         return;
      }
      componentLess.add(currentElement.value);
   });
   return componentLess;
}

/**
 * new Promise(...).then() in AST-tree matches
 * ExpressionStatement with expression of CallExpression type.
 * Only in this case we can add custom errors catcher.
 * @param{Object} node - current AST-tree node
 * @returns {boolean|*}
 */
function isExpressionWithCall(node) {
   return node.type === 'ExpressionStatement' &&
      node.expression && node.expression.type === 'CallExpression';
}

/**
 * Recursively searches matching Promise with require in current
 * AST-tree.
 * @param{} promiseCallbacks
 * @param node
 * @returns {null|boolean|boolean|(null|boolean)}
 */
function recursiveSearchPromise(promiseCallbacks, node) {
   const callExprNode = node.callee;
   if (callExprNode.type !== 'MemberExpression') {
      return null;
   }
   promiseCallbacks.add(callExprNode.property.name);
   const memberExprNode = callExprNode.object;
   switch (memberExprNode.type) {
      case 'NewExpression':
         if (memberExprNode.callee && memberExprNode.callee.name === 'Promise') {
            let isPromiseWithRequire = false;
            traverse(memberExprNode, {
               enter(currentNode) {
                  if (
                     currentNode.expression && currentNode.expression.type === 'CallExpression' &&
                     currentNode.expression.callee && currentNode.expression.callee.name === 'require'
                  ) {
                     isPromiseWithRequire = true;
                     this.break();
                  }
               }
            });
            return isPromiseWithRequire;
         }
         return false;
      case 'CallExpression':
         return recursiveSearchPromise(promiseCallbacks, memberExprNode);
      default:
         return null;
   }
}

function parseJsComponent(text, testsBuild) {
   const startTime = Date.now();
   const result = {};
   let ast;
   try {
      ast = esprima.parse(text);
   } catch (error) {
      throw new Error(`Ошибка при парсинге: ${error.toString()}`);
   }

   let returnStatement;
   const arrExpr = [];

   /**
    * less dependencies can be defined several times in different parts of current component
    * We need to collect all entries for entire component to get whole coverage map of less
    */
   const lessDeps = new Set();
   let needToReplace = false;
   const nodesToBeReplaced = [];
   traverse(ast, {
      enter(node) {
         if (
            findExpression(node, 'webPage') &&
            node.expression.right &&
            node.expression.right.type === 'ObjectExpression'
         ) {
            arrExpr.push(node.expression);
         }

         if (testsBuild) {
            let lessSearchResult = getLessPropertyInAssignment(node);
            if (lessSearchResult) {
               lessSearchResult.forEach(less => lessDeps.add(less));
            }

            lessSearchResult = getLessPropertyInObject(node);
            if (lessSearchResult) {
               lessSearchResult.forEach(less => lessDeps.add(less));
            }
         }

         if (findExpression(node, 'title') && node.expression.right && node.expression.right.type === 'Literal') {
            arrExpr.push(node.expression);
         }

         /**
          * If we have found promise with require and without callback catching errors,
          * add our callback and rewrite current module content.
          */
         if (isExpressionWithCall(node)) {
            const expressionCallback = new Set();
            const searchResult = recursiveSearchPromise(expressionCallback, node.expression);
            if (searchResult && !expressionCallback.has('catch')) {
               needToReplace = true;
               const resultedAst = { ...defaultCatchAst };
               resultedAst.callee.object = node.expression;
               nodesToBeReplaced.push({
                  treePath: this.path(),
                  resultedAst: JSON.parse(JSON.stringify(resultedAst))
               });
            }
         }

         if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'define') {
            if (node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string') {
               result.componentName = node.arguments[0].value;
            }
            const index = node.arguments.length > 2 ? 1 : 0;
            if (node.arguments[index].type === 'ArrayExpression' && node.arguments[index].elements instanceof Array) {
               result.componentDep = [];
               node.arguments[index].elements.forEach((elem) => {
                  if (elem && elem.value) {
                     result.componentDep.push(elem.value);
                     if (testsBuild && elem.value.startsWith('css!')) {
                        lessDeps.add(elem.value.replace(/css!(theme\?)?/, ''));
                     }
                     if (isPrivate(elem.value)) {
                        result.privateDependencies = true;
                     }
                  }
               });
            }

            let fnNode = null;
            if (node.arguments[1] && node.arguments[1].type === 'FunctionExpression') {
               fnNode = node.arguments[1].body;
            } else if (node.arguments[2] && node.arguments[2].type === 'FunctionExpression') {
               fnNode = node.arguments[2].body;
            }
            if (fnNode) {
               if (fnNode.body && fnNode.body instanceof Array) {
                  fnNode.body.forEach((i) => {
                     if (i.type === 'ReturnStatement') {
                        returnStatement = i.argument;
                     }
                  });
               }
            }
         }
      }
   });

   if (arrExpr.length && returnStatement) {
      const opts = {};

      arrExpr.forEach((expr) => {
         if (expr.left.object.name === returnStatement.name) {
            if (expr.right.type === 'ObjectExpression') {
               opts[expr.left.property.name] = parseObjectExpression(expr.right.properties);
            } else {
               opts[expr.left.property.name] = expr.right.value;
            }
         }
      });

      if (opts.hasOwnProperty('webPage')) {
         // отсеем то, что не запланировано
         result.webPage = {};
         if (opts.webPage.hasOwnProperty('htmlTemplate') && opts.webPage.htmlTemplate) {
            result.webPage.htmlTemplate = opts.webPage.htmlTemplate.trim();
         }
         if (opts.webPage.hasOwnProperty('title') && opts.webPage.title) {
            result.webPage.title = opts.webPage.title;
         } else if (opts.hasOwnProperty('title') && opts.title) {
            result.webPage.title = opts.title;
         }
         if (opts.webPage.hasOwnProperty('outFileName') && opts.webPage.outFileName) {
            result.webPage.outFileName = opts.webPage.outFileName;
         }
         if (opts.webPage.hasOwnProperty('urls') && opts.webPage.urls) {
            result.webPage.urls = opts.webPage.urls;
         }
      }
   }

   if (lessDeps.size > 0) {
      result.lessDependencies = Array.from(lessDeps);
   }
   if (result.hasOwnProperty('componentDep') && result.componentName) {
      result.isNavigation = result.componentDep.some(name => NAME_NAVIGATION.test(name));
   }

   if (needToReplace) {
      nodesToBeReplaced.reverse().forEach((node) => {
         const nodePath = node.treePath;
         const parentsPromises = nodesToBeReplaced.filter((testingNode) => {
            const testingNodePath = testingNode.treePath;
            return nodePath.toString().startsWith(testingNodePath.toString()) &&
               nodePath.length > testingNodePath.length;
         });

         /**
          * make sure parent promises will get actual code for nested promises
          */
         if (parentsPromises.length > 0) {
            parentsPromises.forEach((currentParentPromise) => {
               const relativeTreePath = nodePath.slice(
                  currentParentPromise.treePath.length + 1,
                  nodePath.length
               );
               const { parent, lastProperty } = getParentNodeByTreePath(
                  currentParentPromise.resultedAst.callee.object,
                  relativeTreePath
               );
               parent[lastProperty] = node.resultedAst;
            });
         } else {
            const { parent, lastProperty } = getParentNodeByTreePath(ast, nodePath);
            parent[lastProperty] = node.resultedAst;
         }
      });
      result.patchedText = escodegen.generate(ast);
   }
   result.passedTime = Date.now() - startTime;
   return result;
}

/**
 * Walk through ast-tree by current promise tree path
 * and get current promise parent node
 * @param ast
 * @param treePath
 * @returns {{parent: *, lastProperty: *}}
 */
function getParentNodeByTreePath(ast, treePath) {
   let currentNode = ast;
   for (let i = 0; i < treePath.length - 1; i++) {
      currentNode = currentNode[treePath[i]];
   }

   return {
      parent: currentNode,
      lastProperty: treePath[treePath.length - 1]
   };
}

module.exports = parseJsComponent;
