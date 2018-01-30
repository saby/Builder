'use strict';

const through = require('through2'),
   convertHtmlTmpl = require('../lib/convert-html-tmpl'),
   logger = require('./../lib/logger').logger();

module.exports = function() {
   return through.obj(function(file, encoding, cb) {
      convertHtmlTmpl(file.contents.toString(), '', (error, result) => {
         if (error) {
            logger.error(
               {
                  code: 1,
                  message: 'Ошибка при обработке шаблона',
                  error: error,
                  moduleInfo: file.moduleInfo,
                  filePath: file.history[0]
               }
            );
         } else {
            file.contents = new Buffer(result);
            this.push(file);
         }
         cb();
      });
   });
};
