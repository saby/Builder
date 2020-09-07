'use strict';

const helpers = require('../helpers'),
   transliterate = require('../transliterate');

const { requireJsSubstitutions } = require('../builder-constants');
let DoT;

function buildXhtml(text, relativeFilePath) {
   // DoT processor should be required only after buildXhtml function
   // is actually called. It'll be a full guarantee that core has been fully
   // compiled and downloaded
   if (!DoT) {
      DoT = global.requirejs('Core/js-template-doT');
   }
   const prettyRelativeFilePath = helpers.removeLeadingSlashes(helpers.prettifyPath(relativeFilePath));
   let currentNode = prettyRelativeFilePath.replace(/\.xhtml$/g, '');
   for (const pair of requireJsSubstitutions) {
      if (currentNode.startsWith(pair[0])) {
         currentNode = currentNode.replace(pair[0], pair[1]);
         break;
      }
   }

   // currentNode может содержать пробелы. Нужен transliterate
   currentNode = transliterate(currentNode);
   const templateName = `html!${currentNode}`;

   const config = DoT.getSettings();

   const template = DoT.template(text, config, undefined, undefined, currentNode);
   const contents =
      `define("${templateName}",["i18n!${currentNode.split('/')[0]}"],function(){` +
      `var f=${template.toString().replace(/[\n\r]/g, '')};` +
      'f.toJSON=function(){' +
      `return {$serialized$:"func", module:"${templateName}"}` +
      '};return f;});';
   return {
      nodeName: templateName,
      text: contents
   };
}

module.exports = {
   buildXhtml
};
