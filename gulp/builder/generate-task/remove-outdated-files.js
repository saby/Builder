/**
 * All needed functionality to remove outdated files from builder's cache
 * @author Kolbeshin F.A.
 */
'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Common class for updating common builder meta files
 * according to list of outdated(removed) files.
 */
class MetaClass {
   constructor() {
      this.meta = {};
   }

   // Adds outdated file into corresponding meta list to be updated further
   add(metaName, moduleName, fileName) {
      if (!this.meta[moduleName]) {
         this.meta[moduleName] = {};
      }
      if (!this.meta[moduleName][metaName]) {
         this.meta[moduleName][metaName] = [];
      }
      this.meta[moduleName][metaName].push(fileName);
   }

   // reads, updates and saves all meta files that have to be updated
   async updateFiles(outputPath) {
      const promises = [];
      for (const moduleName in this.meta) {
         if (this.meta.hasOwnProperty(moduleName)) {
            for (const metaName in this.meta[moduleName]) {
               if (this.meta[moduleName].hasOwnProperty(metaName)) {
                  promises.push((async() => {
                     const metaPath = path.join(outputPath, moduleName, '.builder', metaName);

                     /**
                      * some meta files can be created only in case of custom pack enabled.
                      * Therefore there is no need of updating of the meta.
                       */
                     if (await fs.pathExists(metaPath)) {
                        const currentMeta = await fs.readJson(metaPath);
                        const newMeta = currentMeta.filter(
                           currentElement => !this.meta[moduleName][metaName].includes(currentElement)
                        );
                        await fs.outputJson(metaPath, newMeta.sort());
                     }
                  })());
               }
            }
         }
      }
      await Promise.all(promises);
   }
}

/**
 * Generates a task for removing of outdated files(removed from repo)
 * @param taskParameters
 * @returns {removeOutdatedFiles}
 */
function generateTaskForRemoveFiles(taskParameters) {
   return async function removeOutdatedFiles() {
      const startTime = Date.now();
      const normalizedOutputDirectory = `${taskParameters.config.outputPath.replace(/\\/g, '/')}/`;
      const filesForRemove = await taskParameters.cache.getListForRemoveFromOutputDir(
         normalizedOutputDirectory,
         taskParameters.config.modulesForPatch
      );
      if (filesForRemove.length === 0) {
         return;
      }
      const metaToUpdate = new MetaClass();
      const removePromises = [];
      filesForRemove.forEach(
         filePath => removePromises.push(
            (async() => {
               await fs.remove(filePath);
               const relativePath = path.relative(
                  taskParameters.config.outputPath,
                  filePath
               ).replace(/\\/g, '/');
               const moduleName = relativePath.split('/')[0];
               if (relativePath.endsWith('.ts')) {
                  metaToUpdate.add(
                     'libraries.json',
                     moduleName,
                     relativePath.replace(/\.ts$/, '')
                  );
               }
            })()
         )
      );
      await Promise.all(removePromises);
      await metaToUpdate.updateFiles(normalizedOutputDirectory);
      taskParameters.storeTaskTime('remove outdated files from output', startTime);
   };
}

module.exports = {
   MetaClass,
   generateTaskForRemoveFiles
};
