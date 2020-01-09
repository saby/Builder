/* eslint-disable global-require */
'use strict';

const initTest = require('./init-test');
const TemplatesBuilder = require('../lib/templates/templates-builder');

let processingTmpl;

describe('convert html.tmpl', () => {
   before(async() => {
      await initTest();
      processingTmpl = require('../lib/templates/processing-tmpl');
   });

   it('basic', async() => {
      const result = await processingTmpl.buildHtmlTmpl(
         '<div>{{1+1}}</div>',
         '',
         {
            servicesPath: '/service',
            application: '/',
            multiService: false
         }
      );
      result.includes('<html application="UI/_base/HTML"').should.equal(true);
   });

   describe('templates config - check wsconfig setup', () => {
      const servicesPath = '/service/';
      const testMultiServiceResults = (templatesConfig) => {
         templatesConfig.RUMEnabled.should.equal('%{RUM_ENABLED}');
         templatesConfig.appRoot.should.equal('%{APPLICATION_ROOT}');
         templatesConfig.wsRoot.should.equal('%{WI.SBIS_ROOT}');
         templatesConfig.resourceRoot.should.equal('%{RESOURCE_ROOT}');
         templatesConfig.pageName.should.equal('%{PAGE_NAME}');
         templatesConfig.servicesPath.should.equal('%{SERVICES_PATH}');
      };
      const testSingleServiceResults = (templatesConfig) => {
         templatesConfig.RUMEnabled.should.equal('false');
         templatesConfig.pageName.should.equal('');
         templatesConfig.servicesPath.should.equal('/service/');
      };
      it('multiService without application', () => {
         const templatesConfig = new TemplatesBuilder();
         templatesConfig.setCommonRootInfo({
            servicesPath,
            application: '/',
            multiService: true
         });
         testMultiServiceResults(templatesConfig);
      });
      it('multiService with application', () => {
         const templatesConfig = new TemplatesBuilder();
         templatesConfig.setCommonRootInfo({
            servicesPath,
            application: '/someRoot/',
            multiService: true
         });
         testMultiServiceResults(templatesConfig);
      });
      it('single service without application', () => {
         const templatesConfig = new TemplatesBuilder();
         templatesConfig.setCommonRootInfo({
            servicesPath,
            application: '/',
            multiService: false
         });
         testSingleServiceResults(templatesConfig);
         templatesConfig.appRoot.should.equal('/');
         templatesConfig.wsRoot.should.equal('/resources/WS.Core/');
         templatesConfig.resourceRoot.should.equal('/resources/');
      });
      it('single service with application', () => {
         const templatesConfig = new TemplatesBuilder();
         templatesConfig.setCommonRootInfo({
            servicesPath,
            application: '/someRoot/',
            multiService: false
         });
         testSingleServiceResults(templatesConfig);
         templatesConfig.appRoot.should.equal('/someRoot/');
         templatesConfig.wsRoot.should.equal('/someRoot/resources/WS.Core/');
         templatesConfig.resourceRoot.should.equal('/someRoot/resources/');
      });
   });
});
