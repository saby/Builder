var indexDict = require('../lib/i18n/indexDictionary').indexDict,
    prepareXHTML = require('../lib/i18n/prepareXHTML').prepareXHTML,
    createResultDict = require('../lib/i18n/createResultDictionary').createResultDict,
    packageDictionary = require('../lib/i18n/packer').packageDictionary,
    jsonGenerator = require('../lib/i18n/jsonGenerator').jsonGenerator;

module.exports = function(grunt) {

   grunt.registerMultiTask('i18n', 'Translate static', function() {
      grunt.log.ok(grunt.template.today('hh:MM:ss') + ': Запускается задача i18n.');

      var taskDone = this.async();
      var taskCount = 0;
      var isDone = false;

      grunt.option('json-generate') && jsonGenerator(grunt, ++taskCount && done);

      grunt.option('make-dict') && createResultDict(grunt, ++taskCount && done);

      grunt.option('prepare-xhtml') && prepareXHTML(grunt, this.data, ++taskCount && done);

      grunt.option('index-dict') && indexDict(grunt, grunt.option('index-dict'), this.data, ++taskCount && done);

      grunt.option('package') && packageDictionary(grunt, this.data, ++taskCount && done);

      if (taskCount == 0) {
         done();
      }

      function done() {
         if (!isDone && --taskCount <= 0) {
            grunt.log.ok(grunt.template.today('hh:MM:ss')+ ': Задача i18n выполнена.');
            isDone = true;
            taskDone();
         }
      }

      return true;
   });
};