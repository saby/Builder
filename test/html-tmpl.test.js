/* eslint-disable global-require */
'use strict';

const initTest = require('./init-test');

let processingTmpl;

describe('convert html.tmpl', () => {
   before(async() => {
      await initTest();
      processingTmpl = require('../lib/processing-tmpl');
   });

   it('basic', async() => {
      const result = await processingTmpl.buildHtmlTmpl('<div>{{1+1}}</div>', '');
      result.includes('<html application="Controls/Application"').should.equal(true);
   });
});
