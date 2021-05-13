'use strict';

const CleanCSS = require('clean-css');

const defaultOptions = {
   advanced: false,
   aggressiveMerging: false,
   compatibility: 'ie8',
   inliner: false,
   keepBreaks: false,
   keepSpecialComments: '*',
   mediaMerging: false,
   processImport: false,
   rebase: false,
   restructuring: false,
   roundingPrecision: 2,
   sourceMap: false
};

const deepOptimizeOptions = {

   /**
    * on 2nd level of optimization clean-css
    * merges css selectors and create 1 common
    * selector with a whole set of properties
    * from all merged selectors. It'll remove all
    * duplicates with the same set of properties
    */
   level: {
      2: {
         all: false,
         mergeAdjacentRules: true,
         removeEmpty: true
      }
   }
};

function runMinifyCss(text, deepOptimize) {
   const startTime = Date.now();
   const minifyOptions = deepOptimize ? { ...defaultOptions, ...deepOptimizeOptions } : defaultOptions;
   const compiled = new CleanCSS(minifyOptions).minify(text);

   let errors = [];
   if (compiled.errors.length) {
      errors = [...compiled.errors];
   }

   if (compiled.warnings.length) {
      errors = [...errors, ...compiled.warnings];
   }
   const compiledCssString = errors.length > 0 ? `/*${errors}*/` : compiled.styles;

   return {
      styles: compiledCssString,
      errors,
      passedTime: Date.now() - startTime
   };
}

module.exports = runMinifyCss;
