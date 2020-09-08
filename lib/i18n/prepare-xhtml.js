'use strict';

const logger = require('../logger').logger();

const isDoT1 = /{\[[\S\s]*]}/,
   isDoT2 = /{{[\S\s]*|[\S\s]*}}/,
   isComment = /^<!--?[\s\S]*?-?->$/,
   isDirective = /%{\w+ [\s\S]+}/,
   isDoctype = /!DOCTYPE/,
   notSpace = /\S/,
   isArray = /Array|array/,
   isContent = /Content|content/;

const optTags = ['option', 'opt', 'options', 'opts'];

let globalComponentsProperties, parser;

/**
 * Добавляет теги шаблонизатора к тексту, для перевода
 * @param text - текст для обрамления {[ ]}
 * @returns String
 */
function addTranslateTagToText(text) {
   const temp = text.trim();

   if (
      !temp ||
      isDoT1.test(temp) ||
      isDoT2.test(temp) ||
      isComment.test(temp) ||
      isDirective.test(temp) ||
      isDoctype.test(temp)
   ) {
      return text;
   }

   return text.replace(temp, `{[${temp}]}`);
}

/**
 * Перебрать все дочерние узлы
 * @param node
 * @param considerTheCurrentNode
 */
function enumChildNodes(node, considerTheCurrentNode) {
   function handleCurrentNode(currentNode) {
      if (
         currentNode.nodeType === 1 &&
         currentNode.nodeName.toLocaleLowerCase() !== 'script' &&
         currentNode.nodeName.toLocaleLowerCase() !== 'style'
      ) {
         if (currentNode.hasAttribute('title')) {
            currentNode.setAttribute('title', addTranslateTagToText(currentNode.getAttribute('title')));
         }

         if (currentNode.nodeName !== 'component') {
            enumChildNodes(currentNode);
         } else {
            translateComponent(currentNode);
         }
      } else if (currentNode.nodeType === 3) {
         if (
            currentNode.nodeValue &&
            notSpace.test(currentNode.nodeValue) &&
            optTags.indexOf(currentNode.parentNode.nodeName) === -1
         ) {
            currentNode.nodeValue = addTranslateTagToText(currentNode.nodeValue);
         }
      }
   }

   if (considerTheCurrentNode) {
      handleCurrentNode(node);
   }

   if (node.nodeType === 1 || node.nodeType === 9) {
      let child = node.firstChild;
      while (child) {
         handleCurrentNode(child);
         child = child.nextSibling;
      }
   }
}

/**
 * Перебирает компонент, ищет переводные свойства в аттрибуте config и перводит теги
 * @param node - элемент компонента
 */
function translateComponent(node) {
   // Для компонента надо вытащить его имя, и найти файл со свойствами
   const moduleName = node.getAttribute('data-component'),
      properties = globalComponentsProperties[moduleName],
      transProp = [];

   if (properties && Object.keys(properties).length && properties.properties && properties.properties['ws-config']) {
      propertiesParser(transProp, properties.properties['ws-config'].options, '', moduleName);
   }

   // Нужно пройтись по детям компонента
   try {
      // Сначала пройдем в глубь и найдем только компоненты
      let child = node.firstChild;
      while (child) {
         if (child.nodeType === 1 && child.nodeName === 'component') {
            translateComponent(child);
         }
         child = child.nextSibling;
      }

      // Теперь займемся опциями
      enumComponentChildNodes(transProp, node, '/');
   } catch (e) {
      logger.error({ error: e });
   }
}

/**
 * Рекурсивно проходит по свойствам компонента и находит все перводные свойства
 * Записывает их в массив transPropXPath
 * @param transPropXPath - массив с путями до переводных свойств
 * @param object - входящий объект
 * @param propPath - текущий путь до объекта
 * @param moduleName
 * @param prevObject
 */
function propertiesParser(transPropXPath, object, propPath, moduleName, prevObject) {
   if (!object) {
      return;
   }

   Object.keys(object).forEach((key) => {
      const elem = object[key];
      let isCompType = '';
      if (isArray.test(elem.type)) {
         isCompType = '@';
      } else if (isContent.test(elem.type)) {
         isCompType = '$';
      }

      if (elem.options) {
         propertiesParser(transPropXPath, elem.options, `${propPath}/${isCompType}${key}`, moduleName, object);
      } else if (elem.itemType) {
         let properties = globalComponentsProperties[elem.itemType || elem.type];
         if (!properties && elem.itemType) {
            const modName = elem.itemType;
            properties = globalComponentsProperties[modName] || {};
         }

         if (
            properties &&
            Object.keys(properties).length &&
            properties.properties &&
            properties.properties['ws-config'] &&
            object !== prevObject
         ) {
            propertiesParser(
               transPropXPath,
               properties.properties['ws-config'].options,
               `${propPath}/${isCompType}${key}`,
               moduleName,
               object
            );
         }
      } else if (elem.translatable || isCompType === '$') {
         transPropXPath.push(`${propPath}/${isCompType}${key}`);
      }
   });
}

/**
 * Перебирает все теги option и options
 * @param transProp
 * @param node
 * @param xPath
 */
function enumComponentChildNodes(transProp, node, xPath) {
   let child = node.firstChild;

   while (child) {
      // Только теги опций
      if (child.nodeType !== 1 || optTags.indexOf(child.nodeName) === -1) {
         // Делаем допущение для обычных html тегов, их тоже подготавливаем
         enumChildNodes(child, true);
         child = child.nextSibling;
         continue;
      }

      const { nodeName } = child,
         name = child.hasAttribute('name') ? child.getAttribute('name') : '',
         value = child.hasAttribute('value') ? child.getAttribute('value') : '',
         type = child.hasAttribute('type') ? child.getAttribute('type') : '';

      // Здесь либо option, либо options, либо components, остальное игнорим
      if (nodeName === 'option' || nodeName === 'opt') {
         // Переберем массив transProp и поищем эту опцию
         for (let i = 0; i < transProp.length; ++i) {
            if (transProp[i] === xPath + name) {
               if (value) {
                  child.setAttribute('value', addTranslateTagToText(value));
               } else {
                  child.innerHTML(addTranslateTagToText(child.innerHTML()));
               }
               break;
            } else if (transProp[i] === `${xPath}$${name}`) {
               // Если опция контент и переводится
               if (value) {
                  child.setAttribute('value', translateDOM(value));
               } else if (child.firstChild && child.firstChild.nodeType === 3 && child.firstChild.nodeValue) {
                  child.firstChild.nodeValue = addTranslateTagToText(child.firstChild.nodeValue);
               } else {
                  enumChildNodes(child);
               }
               break;
            }
         }
      } else if (nodeName === 'options' || nodeName === 'opts') {
         if (isArray.test(type)) {
            const pp = `${xPath}@${name}`;
            let isSimple;

            // Надо понять, массив может хранить сложные типы или нет
            for (let i = 0; i < transProp.length; ++i) {
               if (transProp[i] === pp) {
                  isSimple = true;
                  break;
               } else if (transProp[i].indexOf(pp) !== -1) {
                  isSimple = false;
                  break;
               }
            }

            if (isSimple !== undefined) {
               const { childNodes } = child;
               for (let i = 0; i < childNodes.length; i++) {
                  const childNode = childNodes[i],
                     childNodeName = childNode.nodeName;
                  if (childNode.nodeType === 1) {
                     if (isSimple === true && (childNodeName === 'option' || childNodeName === 'opt')) {
                        if (childNode.hasAttribute('value')) {
                           childNode.setAttribute('value', addTranslateTagToText(childNode.getAttribute('value')));
                        } else {
                           childNode.innerHTML(addTranslateTagToText(childNode.innerHTML()));
                        }
                     } else if (isSimple === false && (childNodeName === 'options' || childNodeName === 'opts')) {
                        enumComponentChildNodes(transProp, childNode, `${pp}/`);
                     }
                  }
               }
            }
         } else {
            enumComponentChildNodes(transProp, child, `${xPath + (child.getAttribute('name') || '')}/`);
         }
      }
      child = child.nextSibling;
   }
}

function translateDOM(text) {
   // ParserUtilities should be required only after prepareXhtml function
   // is actually called. It'll be a full guarantee that core has been fully
   // compiled and downloaded
   if (!parser) {
      parser = global.requirejs('Core/markup/ParserUtilities');
   }
   if (!(typeof parser.parse === 'function')) {
      /* eslint-disable-next-line no-console */
      console.log(`parser has this as API: ${JSON.stringify(parser)}`);
      /* eslint-disable-next-line no-console */
      console.log(`requirejs has this configuration below: ${global.requirejs.s.contexts._.config}`);
      /* eslint-disable-next-line no-console */
      console.log(`is this module defined: ${global.requirejs.defined('Core/markup/ParserUtilities')}`);
      /* eslint-disable-next-line no-console */
      console.log(`require has this cached info for module: ${global.requirejs.s.contexts._.defined['Core/markup/ParserUtilities']}`);
   }
   const dom = parser.parse(text);
   enumChildNodes(dom);
   return dom.outerHTML();
}

/**
 * Проходит по DOM дереву и переводит простые текстовые ноды и компоненты
 * @param {String} text - текст из xhtml файла
 * @param {String} componentsProperties - свойства всех компонентов
 * @returns String
 */
module.exports = function prepareXHTML(text, componentsProperties) {
   globalComponentsProperties = componentsProperties;
   return translateDOM(text);
};
