/* eslint-disable global-require */
'use strict';

const initTest = require('./init-test');
const path = require('path');

let processingTmpl;

describe('build tmpl', () => {
   before(async() => {
      await initTest();
      processingTmpl = require('../lib/templates/processing-tmpl');
   });

   it('basic', async() => {
      let localization = true;
      const testResults = (result) => {
         result.text.startsWith('define(\'wml!TestModule/TestWml\'').should.equal(true);
         result.nodeName.should.equal('wml!TestModule/TestWml');
         result.config.should.deep.equal({
            fileName: 'TestModule/TestWml.wml',
            fromBuilderTmpl: true,
            createResultDictionary: true,
            componentsProperties: 'path/to/components-properties.json',
            generateCodeForTranslations: localization
         });
      };

      let result = await processingTmpl.buildTmpl(
         '<div>{{1+1}}</div>',
         path.normalize('TestModule/TestWml.wml'),
         'path/to/components-properties.json',
         localization
      );
      testResults(result);

      // disable localization, after new build localization should be disabled in result
      localization = false;
      result = await processingTmpl.buildTmpl(
         '<div>{{1+1}}</div>',
         path.normalize('TestModule/TestWml.wml'),
         'path/to/components-properties.json',
         localization
      );
      testResults(result);
   });
});
