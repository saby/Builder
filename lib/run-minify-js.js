'use strict';

const
   terser = require('terser'),
   path = require('path');

/* eslint-disable id-match */
const minifyOptionsBasic = {
   ecma: "9",
   compress: {
      sequences: true,
      properties: false,
      dead_code: true,
      drop_debugger: true,
      conditionals: false,
      comparisons: false,
      evaluate: false,
      booleans: false,
      loops: false,
      unused: false,
      hoist_funs: false,
      if_return: false,
      join_vars: true,
      warnings: false,
      negate_iife: false,
      keep_fargs: true,
      collapse_vars: true
   }
};

const minifyOptionsForMarkup = {
   compress: {
      conditionals: false,
      comparisons: false,
      evaluate: false,
      booleans: false,
      loops: false,
      unused: false,
      if_return: false,
      warnings: false,
      negate_iife: false,
      drop_debugger: false
   },
   mangle: { eval: true }
};
/* eslint-enable id-match */

function runMinifyJs(filePath, text, isMarkup = false) {
   const minifyOptions = { ...(isMarkup ? minifyOptionsForMarkup : minifyOptionsBasic) };

   const dataObject = {
      [path.basename(filePath)]: text
   };

   const minified = terser.minify(dataObject, minifyOptions);
   if (minified.error) {
      throw new Error(JSON.stringify(minified.error));
   } else {
      return minified;
   }
}

module.exports = runMinifyJs;
