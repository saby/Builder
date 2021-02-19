'use strict';

const path = require('path');
const gulp = require('gulp');
const logger = require('../../../lib/logger').logger();
const { typescriptCompiler, clearWorkspaceFromTsConfig } = require('../../../lib/typescript-compiler');
const startTask = require('../../common/start-task-with-timer');


module.exports = function generateTaskForTypescriptCompile(taskParameters) {
   if (!taskParameters.config.tsc) {
      return function skipRunTypescriptCompiler(done) {
         done();
      };
   }

   /*return function runTypescriptCompiler() {
      const tasks = taskParameters.config.modules.map((moduleInfo) => {
         return function typescriptModuleCompile() {
            return gulp
               .src(path.join(moduleInfo.path, '/tsconfig.json'), { dot: false, nodir: true, allowEmpty: true })
               .pipe(
                  plumber({
                     errorHandler(err) {
                        logger.error({
                           message: 'Task markThemeModules was completed with error',
                           error: err,
                           moduleInfo
                        });
                        this.emit('end');
                     }
                  })
               )
               .pipe(mapStream((file, done) => {
                  const fileName = path.basename(file.path);
                  if (fileName === '_theme.less') {
                     /!**
                      * Interface module name for new theme should always contains 3 parts:
                      * 1)Interface module name for current theme
                      * 2)Current theme name
                      * 3) "theme" postfix
                      * Other Interface modules will be ignored from new theme's processing
                      *!/
                     if (currentModuleNameParts.length > 2) {
                        taskParameters.setThemedModule(path.basename(moduleInfo.output), originModule);

                        // if unapproved theme has already been declared in unapproved themes list,
                        // we don't need to log it then.
                        if (!approvedThemes.has(themeName) && !unapprovedThemes.has(themeName)) {
                           logger.warning({
                              message: `Theme "${themeName}" isn't found in approved themes list. You need to get an approval from Begunov A. for this theme first and then write a task to Kolbeshin F. for updating the list.`,
                              moduleInfo
                           });
                           unapprovedThemes.add(themeName);
                        }
                        if (!(taskParameters.config.themes instanceof Array &&
                           !taskParameters.config.themes.hasOwnProperty(themeName)
                        )) {
                           const relativeThemeParts = file.relative.split(path.sep);
                           const currentModifier = relativeThemeParts.length > 1 ? relativeThemeParts[0] : '';
                           moduleInfo.modifiers.push(currentModifier);
                           taskParameters.cache.setBaseThemeInfo(`${themeName}${currentModifier ? `__${currentModifier}` : ''}`);
                           moduleInfo.newThemesModule = true;
                           moduleInfo.themeName = themeName;
                        }
                     }
                  } else if (fileName === 'fallback.json') {
                     try {
                        const currentThemeVariables = JSON.parse(file.contents);
                        taskParameters.cache.addCssVariables(`${moduleInfo.name}/fallback.json`, currentThemeVariables);
                     } catch (error) {
                        logger.error({
                           message: 'An error occurred when tried to parse fallback.json',
                           filePath: file.path,
                           moduleInfo,
                           error
                        });
                     }
                  }
                  done();
               }));
         };
      });*/

   const runTypescriptCompiler = startTask('tsc compiler', taskParameters);
   return gulp.series(
      runTypescriptCompiler.start,
      typescriptCompiler(taskParameters),
      runTypescriptCompiler.finish
   );
};
