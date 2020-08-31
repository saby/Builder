/* eslint-disable global-require */
'use strict';

const initTest = require('./init-test');
const path = require('path');

let processingTmpl;

describe('build template', () => {
   before(async() => {
      await initTest();
      processingTmpl = require('../lib/templates/processing-tmpl');
   });

   it('basic xhtml', async() => {
      const testResults = (result) => {
         result.text.startsWith('define("html!TestModule/TestWml"').should.equal(true);
         result.nodeName.should.equal('html!TestModule/TestWml');
         result.config.should.deep.equal({
            fileName: 'TestModule/TestWml.xhtml',
            fromBuilderTmpl: true,
            createResultDictionary: true,
            componentsProperties: 'path/to/components-properties.json'

         });
      };

      let result = await processingTmpl.buildTemplate(
         '<div>{{= 1+1}}</div>',
         path.normalize('TestModule/TestWml.xhtml'),
         'path/to/components-properties.json'
      );
      testResults(result);

      // disable localization, after new build localization should be disabled in result
      result = await processingTmpl.buildTemplate(
         '<div>{{= 1+1}}</div>',
         path.normalize('TestModule/TestWml.xhtml'),
         'path/to/components-properties.json'
      );
      testResults(result);
   });
   it('basic tmpl', async() => {
      const testResults = (result) => {
         result.text.startsWith('define(\'wml!TestModule/TestWml\'').should.equal(true);
         result.nodeName.should.equal('wml!TestModule/TestWml');
         result.config.should.deep.equal({
            fileName: 'TestModule/TestWml.wml',
            fromBuilderTmpl: true,
            createResultDictionary: true,
            componentsProperties: 'path/to/components-properties.json'
         });
      };

      let result = await processingTmpl.buildTemplate(
         '<div>{{1+1}}</div>',
         path.normalize('TestModule/TestWml.wml'),
         'path/to/components-properties.json'
      );
      testResults(result);

      result = await processingTmpl.buildTemplate(
         '<div>{{1+1}}</div>',
         path.normalize('TestModule/TestWml.wml'),
         'path/to/components-properties.json'
      );
      testResults(result);
   });
});
