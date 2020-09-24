'use strict';

const initTest = require('./init-test');
const path = require('path');
const excludeModuleNames = [
   'require',
   'exports',
   'jquery',
   'tslib',
   'router'
];
const {
   getCurrentNodePlugin,
   checkDependencyForExcludeRules,
   getModuleInfoForCurrentNode,
   isValidDependency
} = require('../lib/check-module-dependencies');

const
   fs = require('fs-extra'),
   { promiseWithTimeout, TimeoutError } = require('../lib/promise-with-timeout');

const generateWorkflow = require('../gulp/builder/generate-workflow.js');

const { linkPlatform, TIMEOUT_FOR_HEAVY_TASKS } = require('./lib');

const workspaceFolder = path.join(__dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json');

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const runWorkflow = function() {
   return new Promise((resolve, reject) => {
      generateWorkflow([`--config="${configPath}"`])((error) => {
         if (error) {
            reject(error);
         } else {
            resolve();
         }
      });
   });
};

/**
 * properly finish test in builder main workflow was freezed by unexpected
 * critical errors from gulp plugins
 * @returns {Promise<void>}
 */
const runWorkflowWithTimeout = async function(timeout) {
   let result;
   try {
      result = await promiseWithTimeout(runWorkflow(), timeout || TIMEOUT_FOR_HEAVY_TASKS);
   } catch (err) {
      result = err;
   }
   if (result instanceof TimeoutError) {
      true.should.equal(false);
   }
};

describe('check-module-dependencies', () => {
   const moduleDependencies = {
      nodes: {
         'css!MyModule1/module1': {
            path: 'path/to/css/MyModule/module1'
         },
         'MyModule1/module1': {
            path: 'path/to/MyModule/module1'
         },
         'css!Lib/Control': {
            path: 'path/to/css/lib/Control'
         },
         'Lib/Control': {
            path: 'path/to/lib/Control'
         },
      }
   };
   const modules = [
      {
         name: 'MyModule1',
         path: 'path/to/MyModule1',
         responsible: 'some responsible'
      },
      {
         name: 'MyModule2',
         path: 'path/to/MyModule2',
         responsible: 'some responsible 2'
      },
      {
         name: 'WS.Core',
         path: 'path/to/WS.Core',
         responsible: 'some responsible of WS.Core'
      }
   ];
   const projectModulesNames = modules.map(
      moduleInfo => path.basename(moduleInfo.path)
   );
   const buildConfig = {
      rawConfig: {
         output: path.join(__dirname, 'fixture/check-module-dependencies')
      }
   };
   before(async() => {
      await initTest();
   });

   it('check node plugin getter', () => {
      let currentName = 'css!myModule/module1';
      let result = getCurrentNodePlugin(currentName);
      result.should.equal('css');
      currentName = 'css!theme?myModule/module1';
      result = getCurrentNodePlugin(currentName);
      result.should.equal('css');
      currentName = 'is!browser?myModule/module1';
      result = getCurrentNodePlugin(currentName);
      result.should.equal('');
      currentName = 'is!browser?is!compatibleLayer?optional!myModule/module1';
      result = getCurrentNodePlugin(currentName);
      result.should.equal('');
      currentName = 'is!browser?is!compatibleLayer?optional!wml!myModule/module1';
      result = getCurrentNodePlugin(currentName);
      result.should.equal('wml');
   });

   it('check dependency for exclude rules', () => {
      excludeModuleNames.forEach((currentExcludeModuleName) => {
         const result = checkDependencyForExcludeRules(
            projectModulesNames,
            currentExcludeModuleName,
            currentExcludeModuleName
         );
         result.should.equal(true);
      });
      let currentName = 'MyModule1/Module';
      let result = checkDependencyForExcludeRules(projectModulesNames, currentName, currentName);
      result.should.equal(false);
      currentName = 'MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
      currentName = '/cdn/MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'cdn/MyModule/module1');
      result.should.equal(true);
      currentName = 'optional!MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
      currentName = 'is!compatibleLayer?optional!MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
      currentName = 'is!browser?i18n!MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
      currentName = 'i18n!MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
      currentName = 'css!theme?MyModule/module1';
      result = checkDependencyForExcludeRules(projectModulesNames, currentName, 'MyModule/module1');
      result.should.equal(true);
   });

   it('get correct moduleInfo for current dependency', () => {
      let nodeName = 'optional!MyModule1/module1';
      let result = getModuleInfoForCurrentNode(nodeName, modules);
      (!!result).should.equal(true);
      nodeName = 'Lib/myModule1';
      result = getModuleInfoForCurrentNode(nodeName, modules);
      (!!result).should.equal(true);
      nodeName = 'css!Lib/myModule1';
      result = getModuleInfoForCurrentNode(nodeName, modules);
      (!!result).should.equal(true);
      Object.keys(result).should.have.members(['name', 'path', 'responsible']);
      nodeName = 'thirdParty/myModule1';
      result = getModuleInfoForCurrentNode(nodeName, modules);
      (!!result).should.equal(false);
   });

   it('check dependencies validity: meta nodes has current dependency', async() => {
      let nodeName = 'css!MyModule1/module1';
      let result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);

      nodeName = 'css!Lib/Control';
      result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);
   });

   it('check dependencies validity: meta nodes doesn\'t have current dependency, but exists in output', async() => {
      let nodeName = 'css!MyModule1/testFileSystemCheck';
      let result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);

      nodeName = 'css!Lib/styleInFileSystem';
      result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);

      nodeName = 'text!MyModule1/index.html';
      result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);

      nodeName = 'html!MyModule1/oldTemplate';
      result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);

      nodeName = 'browser!text!MyModule1/index.html';
      result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(true);
   });

   it('check dependencies validity: meta nodes doesn\'t have current dependency and doesn\'t exists in output', async() => {
      const nodeName = 'css!MyModule1/testNotExistingNode';
      const result = await isValidDependency(projectModulesNames, moduleDependencies, nodeName, buildConfig);
      result.should.equal(false);
   });

   it('check module-dependencies flag must return errors list', async() => {
      await linkPlatform(sourceFolder);
      const fixtureFolder = path.join(__dirname, 'fixture/check-module-dependencies');
      const testResults = async(value) => {
         const { messages } = await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'));
         let resultsHasDepsAnalizerErrors = false;
         messages.forEach((currentMessageObject) => {
            if (currentMessageObject.message.includes('Error analizing dependencies: file for dependency')) {
               resultsHasDepsAnalizerErrors = true;
            }
         });
         resultsHasDepsAnalizerErrors.should.equal(value);
      };

      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         less: true,
         typescript: true,
         dependenciesGraph: true,
         builderTests: true,
         modules: [
            {
               name: 'MyModule',
               path: path.join(fixtureFolder, 'MyModule')
            }
         ]
      };
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout();

      // for build without deps checker result must not have messages with deps analizer errors
      await testResults(false);

      // enable deps checker and rebuild current test
      config.checkModuleDependencies = 'error';
      await fs.writeJSON(configPath, config);
      await runWorkflowWithTimeout();

      // for build with deps checker result must have messages with deps analizer errors
      await testResults(true);
      await clearWorkspace();
   });
   it('check module-dependencies flag must not return list of errors for private modules of packed libraries', async() => {
      await linkPlatform(sourceFolder);
      const fixtureFolder = path.join(__dirname, 'fixture/check-module-dependencies');
      const testResults = async(value) => {
         const currentMessages = (await fs.readJson(path.join(workspaceFolder, 'logs/builder_report.json'))).messages;
         let resultsHasDepsAnalizerErrors = false;
         currentMessages.forEach((currentMessageObject) => {
            if (currentMessageObject.message.includes('Error analizing dependencies: file for dependency')) {
               resultsHasDepsAnalizerErrors = true;
            }
         });
         resultsHasDepsAnalizerErrors.should.equal(value);
      };

      const gulpConfig = {
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         less: true,
         typescript: true,
         dependenciesGraph: true,
         minimize: true,
         sources: false,
         checkModuleDependencies: 'error',
         builderTests: true,
         modules: [
            {
               name: 'MyModule1',
               path: path.join(fixtureFolder, 'MyModule1')
            }
         ]
      };
      await fs.writeJSON(configPath, gulpConfig);
      await runWorkflowWithTimeout();

      // for build without deps checker result must not have messages with deps analizer errors
      await testResults(false);

      await runWorkflowWithTimeout();

      // for build with deps checker result must have messages with deps analizer errors
      await testResults(false);
      await clearWorkspace();
   });
});
