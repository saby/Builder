'use strict';

const initTest = require('./init-test');

const runMinifyJs = require('../lib/run-minify-js');

describe('run minify-js', () => {
   before(async() => {
      await initTest();
   });
   it('empty', () => {
      const text = '';
      const result = runMinifyJs('virtual.js', text);
      result.code.should.equal('');
   });
   it('minifyjs-test-eval-minify', () => {
      /**
       * uglifyJS had a bug that breaks down determining of
       * global object. Check this case also for new compressor
       * "terser"
       */

      const text = "(function(){ return this || (0,eval)('this'); }())";
      const result = runMinifyJs('virtual.js', text);
      result.code.should.equal('(function(){this||(0,eval)("this")})();');
   });
   it('simple', () => {
      const text = 'var r = 0;';
      const result = runMinifyJs('virtual.js', text);
      result.code.should.equal('var r=0;');
   });
   it('simple test for typeof undefined', () => {
      // нельзя заменять "undefined" === typeof test1 на void 0 === test1
      // это не равнозначные действия
      const text = 'if("undefined" === typeof test1){test2 = 0;}';

      const result = runMinifyJs('virtual.js', text, false);
      result.code.should.equal('if("undefined"===typeof test1)test2=0;');

      const resultForMarkup = runMinifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal('if("undefined"===typeof test1)test2=0;');
   });

   it('complex test for typeof undefined', () => {
      // нельзя заменять "undefined" === typeof test1 на void 0 === test1
      // это не равнозначные действия

      const text =
         '(function() {\n' +
         "   var thelpers = typeof tclosure === 'undefined' || !tclosure ? arguments[arguments.length - 1] : tclosure;\n" +
         "   if (typeof thelpers === 'undefined') {\n" +
         '      console.log(1);\n' +
         '   }\n' +
         '})();';

      const result = runMinifyJs('virtual.js', text, false);
      const text1 =
         '(function() {\n' +
         "   const test = () => { return '123'; }; test();" +
         '})();';

      const result1 = runMinifyJs('virtual.js', text1, false);
      console.log(result1);
      result.code.should.equal(
         '(function(){var e="undefined"===typeof tclosure||!tclosure?arguments[arguments.length-1]:tclosure;if("undefined"===typeof e)console.log(1)})();'
      );

      const resultForMarkup = runMinifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal(
         '(function(){var e="undefined"===typeof tclosure||!tclosure?arguments[arguments.length-1]:tclosure;if("undefined"===typeof e)console.log(1)})();'
      );
   });
});
