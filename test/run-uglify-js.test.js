'use strict';

const chai = require('chai'),
   runUglifyJs = require('../lib/run-uglify-js');

chai.should();

describe('run uglify-js', function() {
   it('empty', () => {
      const text = '';
      const result = runUglifyJs('virtual.js', text);
      result.code.should.equal('');
   });
   it('simple', () => {
      const text = 'var r = 0;';
      const result = runUglifyJs('virtual.js', text);
      result.code.should.equal('var r=0;');
   });
   it('simple test for typeof undefined', () => {
      //нельзя заменять "undefined" === typeof test1 на void 0 === test1
      //это не равнозначные действия
      const text = 'if("undefined" === typeof test1){test2 = 0;}';

      const result = runUglifyJs('virtual.js', text, false);
      result.code.should.equal('if("undefined"===typeof test1)test2=0;');

      const resultForMarkup = runUglifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal('"undefined"===typeof test1&&(test2=0);');
   });

   it('complex test for typeof undefined', () => {
      //нельзя заменять "undefined" === typeof test1 на void 0 === test1
      //это не равнозначные действия

      const text = '(function() {\n' +
         '   var thelpers = typeof tclosure === \'undefined\' || !tclosure ? arguments[arguments.length - 1] : tclosure;\n' +
         '   if (typeof thelpers === \'undefined\') {\n' +
         '      console.log(1);\n' +
         '   }\n' +
         '})();';

      const result = runUglifyJs('virtual.js', text, false);
      result.code.should.equal('(function(){var e;if("undefined"===typeof("undefined"===typeof tclosure||!tclosure?arguments[arguments.length-1]:tclosure))console.log(1)})();');

      const resultForMarkup = runUglifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal('!function(){"undefined"===typeof("undefined"!==typeof tclosure&&tclosure?tclosure:arguments[arguments.length-1])&&console.log(1)}();');
   });
});

