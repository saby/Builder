/**
 * Plugin to add all missing themes with its content into common
 * build stream
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path');
const Vinyl = require('vinyl');
const through = require('through2');

/**
 * Объявление плагина
 * @param {TaskParameters} taskParameters параметры для задач
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo = null) {
   let missingThemesAdded = false;
   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         if (missingThemesAdded) {
            callback(null, file);
            return;
         }
         const missingThemes = taskParameters.cache.getMissingThemes();

         Object.keys(missingThemes)
            .forEach((currentTheme) => {
               if (currentTheme.startsWith(path.join(moduleInfo.path, path.sep))) {
                  this.push(
                     new Vinyl({
                        base: moduleInfo.path,
                        path: path.join(currentTheme, 'theme.less'),
                        contents: Buffer.from(missingThemes[currentTheme]),
                        stat: {
                           mtime: new Date().toString()
                        },
                        strictCopy: true
                     })
                  );
               }
            });
         missingThemesAdded = true;
         callback(null, file);
      }
   );
};
