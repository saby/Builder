/* eslint-disable no-unused-vars */
'use strict';

const { readConfigFileSync } = require('../gulp/common/configuration-reader');
const initTest = require('./init-test');
const Configuration = require('../gulp/builder/classes/configuration');
const path = require('path');
const fs = require('fs-extra');
const workspaceFolder = path.join(__dirname, 'workspace');
const cacheFolder = path.join(workspaceFolder, 'cache');
const configPath = path.join(workspaceFolder, 'gulp_config.json');

describe('gulp configuration reader', () => {
   before(async() => {
      await initTest();
   });
   it('must throw an error if path for config wasn\'t selected', () => {
      try {
         const result = readConfigFileSync(null, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal('You need to set up the path to gulp configuration file.');
      }
   });
   it('must throw an error if config not existing', () => {
      const testPath = path.join(workspaceFolder, 'someBadPath/gulp_config.json');
      try {
         const result = readConfigFileSync(testPath, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal(`Config file '${testPath}' doesn't exists.`);
      }
   });
   it('must throw an error if modules parameter absents', async() => {
      const config = {};
      await fs.outputJson(configPath, config);
      try {
         const result = readConfigFileSync(configPath, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal('Parameter "modules" must be specified.');
      }
   });
   it('must throw an error if modules parameter is invalid', async() => {
      const config = {
         modules: {}
      };
      await fs.outputJson(configPath, config);
      try {
         const result = readConfigFileSync(configPath, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal('Parameter "modules" must be specified as array only.');
      }
   });
   it('must throw an error if modules parameter specified as empty array', async() => {
      const config = {
         modules: []
      };
      await fs.outputJson(configPath, config);
      try {
         const result = readConfigFileSync(configPath, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal('Parameter "modules" cannot be specified as empty array.');
      }
   });
   it('must throw an error if modules parameter\'s member has no selected path', async() => {
      const config = {
         modules: [{
            name: 'Test'
         }]
      };
      await fs.outputJson(configPath, config);
      try {
         const result = readConfigFileSync(configPath, __dirname);

         // forcibly fail test if config read was completed successfully
         false.should.equal(true);
      } catch (err) {
         err.message.should.equal('For current module "Test" path must be specified.');
      }
   });
   it('must throw an error if cache parameter absents', async() => {
      const config = {
         modules: [{
            name: 'Модуль',
            path: path.join(__dirname, 'fixture/custompack/Модуль')
         }]
      };
      await fs.outputJson(configPath, config);
      const result = readConfigFileSync(configPath, __dirname);
      result.cache.should.equal(path.join(__dirname, '../.builder/cache'));
   });
   it('must throw an error if output parameter absents', async() => {
      const config = {
         cache: cacheFolder,
         modules: [{
            name: 'Модуль',
            path: path.join(__dirname, 'fixture/custompack/Модуль')
         }]
      };
      await fs.outputJson(configPath, config);
      const result = readConfigFileSync(configPath, __dirname);
      result.output.should.equal(path.join(__dirname, '../.builder/output'));
   });
   it('all relative paths must be resolved', async() => {
      const getResolvedPath = currentPath => path.resolve(workspaceFolder, currentPath).replace(/\\/g, '/');
      const config = {
         cache: './cache-folder',
         output: './output-folder',
         logs: './logs-folder',
         modules: [{
            name: 'Модуль',
            path: '../fixture/custompack/Модуль'
         }]
      };
      await fs.outputJson(configPath, config);
      const result = readConfigFileSync(configPath, __dirname);

      result.should.deep.equal({
         cache: getResolvedPath('./cache-folder'),
         output: getResolvedPath('./output-folder'),
         logs: getResolvedPath('./logs-folder'),
         modules: [{
            name: 'Модуль',
            path: getResolvedPath('../fixture/custompack/Модуль')
         }]
      });
   });
});
describe('gulp configuration set', () => {
   const config = {
      rawConfig: {
         cache: path.resolve(__dirname, './cache-folder'),
         output: path.resolve(__dirname, './output-folder'),
         logs: path.resolve(__dirname, './logs-folder'),
         modules: [{
            name: 'Модуль',
            path: path.resolve(__dirname, '../fixture/custompack/Модуль')
         }]
      }
   };

   it('application for rebasing in packages must be configured properly', () => {
      const runParameters = new Configuration();
      const { rawConfig } = config;
      rawConfig['url-service-path'] = '/service/';
      rawConfig['ui-service-path'] = '/someCustomService/';
      rawConfig['multi-service'] = false;
      runParameters.rawConfig = rawConfig;
      runParameters.configMainBuildInfo();
      runParameters.applicationForRebase.should.equal('/someCustomService/');
   });
});
