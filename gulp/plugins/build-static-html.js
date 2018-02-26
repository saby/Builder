/* eslint-disable no-invalid-this */

'use strict';

const through = require('through2'),
   Vinyl = require('vinyl'),
   path = require('path'),
   transliterate = require('../../lib/transliterate'),
   helpers = require('../../lib/helpers'),
   generateStaticHtmlForJs = require('../../lib/generate-static-html-for-js'),
   logger = require('../../lib/logger').logger();

module.exports = function(changesStore, moduleInfo, modulesMap) {
   return through.obj(function(file, encoding, callback) {
      callback(null, file);
   }, async function(callback) {
      try {
         const config = {}; //TODO:нужно доработать для desktop приложений
         const componentsInfo = changesStore.getComponentsInfo(moduleInfo.name);
         const promises = Object.keys(componentsInfo).map(async(filePath) => {
            try {
               return await generateStaticHtmlForJs(filePath, componentsInfo[filePath], moduleInfo.contents, config, modulesMap, false);
            } catch (error) {
               logger.error({
                  message: 'Ошибка при генерации статической html для JS',
                  filePath: filePath,
                  error: error,
                  moduleInfo: moduleInfo
               });
            }
            return null;
         });
         const results = await Promise.all(promises);
         for (const result of results) {
            if (result) {
               const folderName = transliterate(moduleInfo.folderName);
               moduleInfo.staticTemplates[result.outFileName] = path.join(folderName, result.outFileName);
               this.push(new Vinyl({
                  base: moduleInfo.output,
                  path: path.join(moduleInfo.output, result.outFileName),
                  contents: Buffer.from(result.text)
               }));
            }
         }

         //Всегда сохраняем файл, чтобы не было ошибки при удалении последней статической html страницы в модуле.
         const file = new Vinyl({
            path: 'static_templates.json',
            contents: Buffer.from(JSON.stringify(helpers.sortObject(moduleInfo.staticTemplates), null, 2)),
            moduleInfo: moduleInfo
         });
         callback(null, file);
         return;
      } catch (error) {
         logger.error({
            message: 'Ошибка Builder\'а',
            error: error,
            moduleInfo: moduleInfo
         });
      }
      callback();
   });
};
