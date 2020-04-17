'use strict';

const initTest = require('./init-test');
const Cache = require('../gulp/builder/classes/cache');

describe('builder cache', () => {
   before(async() => {
      await initTest();
   });

   it('check dependencies cache for less', () => {
      const currentCache = new Cache({});
      currentCache.currentStore.dependencies = {
         dependencies: {}
      };
      const currentDependencies = currentCache.currentStore.dependencies;
      currentCache.addDependencies('myModule/style', ['firstTheme/styles']);
      currentDependencies.hasOwnProperty('myModule/style').should.equal(true);
      currentDependencies['myModule/style'].should.have.members(['firstTheme/styles']);
      currentCache.addDependencies('myModule/style', ['secondTheme/styles']);
      currentDependencies.hasOwnProperty('myModule/style').should.equal(true);
      currentDependencies['myModule/style'].should.have.members(['firstTheme/styles', 'secondTheme/styles']);
   });
});
