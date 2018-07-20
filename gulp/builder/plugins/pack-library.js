/**
 * Плагин для паковки приватных частей библиотеки.
 * Приватная часть библиотеки - AMD-модуль, в начале имени
 * которого присутствует символ "_" или расположенных в
 * поддиректории папки, имя которой начинается с "_"
 * @author Колбешин Ф.А.
 */

'use strict';

const through = require('through2'),
   path = require('path'),
   logger = require('../../../lib/logger').logger(),
   libPackHelpers = require('../../../lib/pack/helpers/librarypack'),
   { packCurrentLibrary } = require('../../../lib/pack/library-packer'),
   { getSourcePathByModuleName } = require('../../../lib/pack/helpers/changes-store'),
   esExt = /\.(es|ts)$/;

/**
 * Объявление плагина
 * @param {ChangesStore} changesStore кеш
 * @param {ModuleInfo} moduleInfo информация о модуле
 * @param {Pool} pool пул воркеров
 * @returns {*}
 */
module.exports = function declarePlugin(config, changesStore, moduleInfo) {
   const
      libraries = [],
      root = config.rawConfig.output;

   return through.obj(

      /* @this Stream */
      function onTransform(file, encoding, callback) {
         if (
            file.extname === '.js' &&
            esExt.test(file.history[0]) &&
            !libPackHelpers.isPrivate(path.relative(moduleInfo.output, file.path))
         ) {
            libraries.push(file);
            callback();
         } else {
            callback(null, file);
         }
      },

      /* @this Stream */
      function onFlush(callback) {
         const privatePartsCache = changesStore.getCompiledEsModuleCache(moduleInfo.name);
         libraries.forEach((library) => {
            const privatePartsForChangesStore = [];
            let result;
            try {
               result = packCurrentLibrary(
                  root,
                  privatePartsForChangesStore,
                  library.contents.toString(),
                  privatePartsCache
               );
            } catch (error) {
               logger.error({
                  error
               });
            }
            if (privatePartsForChangesStore.length > 0) {
               changesStore.addDependencies(library.history[0], privatePartsForChangesStore.map(
                  dependency => getSourcePathByModuleName(privatePartsCache, dependency)
               ));
            }
            library.modulepack = result;
            this.push(library);
         });
         callback(null);
      }
   );
};
