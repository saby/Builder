'use strict';
const helpers = require('./../lib/utils/helpers'),
    fs = require('fs'),
    path = require('path'),
    humanize = require('humanize'),
    less = require('less'),
    getModuleNameRegExp = new RegExp('\/resources\/([^/]+)'),
    DEFAULT_THEME = 'online',
    themes = ['online', 'carry', 'presto'],
    dblSlashes = /\\/g;
/**
 @workaround Временно ресолвим текущую тему по названию модуля.
*/
function resolveThemeName(filepath) {

    let regexpMathch = filepath.match(getModuleNameRegExp, ''),
        s3modName = regexpMathch ? regexpMathch[1] : 'smth';

    switch (s3modName) {
        case 'Upravlenie_oblakom':
            return 'cloud';
        case 'Presto':
            return 'presto';
        case 'sbis.ru':
            return 'sbisru';
        case 'Retail':
            return 'carry';
        default:
            return 'online';
    }
}

function itIsControl(path) {
  let truePath = path.replace(dblSlashes, '/');
  return ~truePath.indexOf('SBIS3.CONTROLS/components');
}

module.exports = function less1by1Task(grunt) {
  let root = grunt.option('root') || '',
      app = grunt.option('application') || '',
      rootPath = path.join(root, app),
   themesPath = path.join(rootPath, '/resources/SBIS3.CONTROLS/themes/');

  function processLessFile(data, filePath, error, theme, itIsControl) {
    if (!data) {
      return;
    }
    let lessData = data.toString(),
        imports = theme ?
        `
            @import '${themesPath}${theme}/variables';
            @import '${themesPath}mixins';
            @themeName: ${theme};

            ` : '';

    less.render(imports + lessData, {
        filename: filePath,
        cleancss: false,
        relativeUrls: true,
        strictImports: true
    }, function writeCSS(compileLessError, output) {

        if (compileLessError) {

            grunt.log.ok(`${compileLessError.message} in file: ${compileLessError.filename} on line: ${compileLessError.line}`);
        }
        let suffix = '';

        if (itIsControl) {
          suffix = ( theme === DEFAULT_THEME ) ? '' : `__${theme}`;
        }
        let newName = `${path.dirname(filePath)}/${path.basename(filePath, '.less')}${suffix}.css`;
        if (output) {
            fs.writeFile(newName, output.css, {flag: 'wx'}, function writeFileCb(writeFileError) {
                if (writeFileError) {
                    grunt.log.ok(`Не могу записать файл. Ошибка: ${writeFileError.message}.`);
            }
                grunt.log.ok(`file ${filePath} successfuly compiled. Theme: ${theme}`);
            });
        }
    });
  }

    grunt.registerMultiTask('less1by1', 'Компилит каждую лесску, ложит cssку рядом. Умеет в темы', function() {

        grunt.log.ok(`${humanize.date('H:i:s')} : Запускается задача less1by1.`);


            let taskDone = this.async();

        helpers.recurse(rootPath, function(filepath, cb) {

            if (helpers.validateFile(path.relative(rootPath, filepath), ['resources/**/*.less', 'ws/**/*.less'])) {
                fs.readFile(filepath, function readFileCb(readFileError, data) {
                  let theme = resolveThemeName(filepath);
                    if (itIsControl(filepath)) {

                      for (let themeName of themes) {
                        processLessFile(data, filepath, readFileError, themeName, true);
                      }
                    }
                    else {
                      processLessFile(data, filepath, readFileError, theme, false);
                    }

                });
            }
            cb();
        }, function() {
            grunt.log.ok(`${humanize.date('H:i:s')} : Задача less1by1 выполнена.`);
            taskDone();
        });

    });


};
