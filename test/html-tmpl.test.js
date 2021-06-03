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
         },
         'UI Module'
      );

      // check if there is a correct base div and base html tags
      result.includes('<div id="wasaby-content"').should.equal(true);
      result.includes('<!DOCTYPE html>').should.equal(true);
      result.includes('<html').should.equal(true);
      result.includes('<head').should.equal(true);
      result.includes('<body').should.equal(true);
      result.includes('</body>').should.equal(true);
      result.includes('</html>').should.equal(true);
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
      describe('multiService', () => {
         describe('without application', () => {
            it('with resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/',
                  resourcesUrl: 'resources/',
                  multiService: true
               });
               testMultiServiceResults(templatesConfig);
            });
            it('without resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/',
                  multiService: true
               });
               testMultiServiceResults(templatesConfig);
            });
         });
         describe('with application', () => {
            it('with resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/someRoot/',
                  resourcesUrl: 'resources/',
                  multiService: true
               });
               testMultiServiceResults(templatesConfig);
            });
            it('without resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/someRoot/',
                  multiService: true
               });
               testMultiServiceResults(templatesConfig);
            });
         });
      });
      describe('single service', () => {
         describe('without application', () => {
            it('with resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/',
                  resourcesUrl: 'resources/',
                  multiService: false
               });
               testSingleServiceResults(templatesConfig);
               templatesConfig.appRoot.should.equal('/');
               templatesConfig.wsRoot.should.equal('/resources/WS.Core/');
               templatesConfig.resourceRoot.should.equal('/resources/');
            });
            it('without resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/',
                  multiService: false
               });
               testSingleServiceResults(templatesConfig);
               templatesConfig.appRoot.should.equal('/');
               templatesConfig.wsRoot.should.equal('/WS.Core/');
               templatesConfig.resourceRoot.should.equal('/');
            });
         });
         describe('with application', () => {
            it('with resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/someRoot/',
                  resourcesUrl: 'resources/',
                  multiService: false
               });
               testSingleServiceResults(templatesConfig);
               templatesConfig.appRoot.should.equal('/someRoot/');
               templatesConfig.wsRoot.should.equal('/someRoot/resources/WS.Core/');
               templatesConfig.resourceRoot.should.equal('/someRoot/resources/');
            });
            it('without resourcesUrl', () => {
               const templatesConfig = new TemplatesBuilder();
               templatesConfig.setCommonRootInfo({
                  servicesPath,
                  application: '/someRoot/',
                  multiService: false
               });
               testSingleServiceResults(templatesConfig);
               templatesConfig.appRoot.should.equal('/someRoot/');
               templatesConfig.wsRoot.should.equal('/someRoot/WS.Core/');
               templatesConfig.resourceRoot.should.equal('/someRoot/');
            });
         });
      });
   });
});
