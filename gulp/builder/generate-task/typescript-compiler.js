'use strict';

const path = require('path');
const gulp = require('gulp');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();
const plumber = require('gulp-plumber');
const through = require('through2');
const {
   strictTypescriptCompiler,
   typescriptCompiler,
   clearWorkspaceFromTsConfig
} = require('../../../lib/typescript-compiler');
const startTask = require('../../common/start-task-with-timer');

const processTsConfig = (taskParameters, moduleInfo) => through.obj(

   /* @this Stream */
   async function onTransform(file, encoding, callback) {
      const currentTsConfig = JSON.parse(file.contents);
      let currentTsConfigName = file.path;
      if (currentTsConfig.extends && currentTsConfig.extends !== '../tsconfig.json') {
         const newFile = file.clone();
         currentTsConfig.extends = '../tsconfig.json';
         currentTsConfigName = newFile.path.replace('.json', '.normalized.json');
         await fs.outputJson(currentTsConfigName, JSON.stringify(currentTsConfig));
      }

      await strictTypescriptCompiler(taskParameters, moduleInfo.name, currentTsConfigName);
      await clearWorkspaceFromTsConfig(path.dirname(currentTsConfigName));
      callback();
   }
);

function clearWorkspaceFromTsConfigTask(sourceDirectory) {
   return function clearTypescriptCompilerArtifacts() {
      return clearWorkspaceFromTsConfig(sourceDirectory, true);
   };
}

module.exports = function generateTaskForTypescriptCompile(taskParameters) {
   if (!taskParameters.config.tsc) {
      return function skipRunTypescriptCompiler(done) {
         done();
      };
   }

   const strictTypescriptCompilerTasks = taskParameters.config.modules.map(
      moduleInfo => function strictTsCompiler() {
         return gulp
            .src(path.join(moduleInfo.path, '/tsconfig.json'), { allowEmpty: true })
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
            .pipe(processTsConfig(taskParameters, moduleInfo));
      }
   );

   const runTypescriptCompiler = startTask('tsc compiler', taskParameters);
   return gulp.series(
      runTypescriptCompiler.start,
      typescriptCompiler(taskParameters),
      gulp.series(strictTypescriptCompilerTasks),
      clearWorkspaceFromTsConfigTask(path.join(taskParameters.config.cachePath, 'temp-modules')),
      runTypescriptCompiler.finish
   );
};
