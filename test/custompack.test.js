'use strict';

require('./init-test');

const
   path = require('path'),
   applicationRoot = path.join(__dirname, 'fixture/custompack'),
   fs = require('fs-extra'),
   packHelpers = require('../lib/pack/helpers/custompack'),
   customPacker = require('../lib/pack/custom-packer'),
   DependencyGraph = require('../packer/lib/dependencyGraph');


describe('custompack', () => {
   let result;
   it('should reject error if include option not exists', async() => {
      try {
         const
            moduleDeps = await fs.readJson(path.join(applicationRoot, 'module-dependencies.json')),
            currentNodes = Object.keys(moduleDeps.nodes),
            currentLinks = Object.keys(moduleDeps.links),
            depsTree = new DependencyGraph();

         if (currentLinks.length > 0) {
            currentLinks.forEach((link) => {
               depsTree.setLink(link, moduleDeps.links[link]);
            });
         }
         if (currentNodes.length > 0) {
            currentNodes.forEach((node) => {
               const currentNode = moduleDeps.nodes[node];
               currentNode.path = currentNode.path.replace(/^resources\//, '');
               depsTree.setNode(node, currentNode);
            });
         }
         const config = await fs.readJson(path.join(applicationRoot, 'configs/without-include.package.json'));
         const configsArray = packHelpers.getConfigsFromPackageJson(
            path.normalize('configs/without-include.package.json'),
            applicationRoot,
            config
         );
         const currentResult = await customPacker.generateCustomPackage(
            depsTree,
            applicationRoot,
            configsArray[0],
            true,
            true,
            []
         );
         result = currentResult;
      } catch (err) {
         result = err;
      }

      (result instanceof Error).should.equal(true);
      result.message.should.equal('Конфиг для кастомного пакета должен содержать опцию include для нового вида паковки.');
   });
});
