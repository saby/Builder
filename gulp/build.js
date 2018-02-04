'use strict';

const
   path = require('path'),
   gulp = require('gulp'),
   gulpRename = require('gulp-rename'),
   clean = require('gulp-clean');

const
   gulpHtmlTmpl = require('./plugins/html-tmpl'),
   changedInPlace = require('./plugins/changed-in-place'),
   addComponetInfo = require('./plugins/add-component-info'),
   buildStaticHtml = require('./plugins/build-static-html'),
   createRoutesInfoJson = require('./plugins/create-routes-info-json'),
   createContentsJson = require('./plugins/create-contents-json');

const
   transliterate = require('../lib/transliterate'),
   ChangesStore = require('./classes/changes-store');

const copyTaskGenerator = function(moduleInfo, changesStore) {
   const moduleInput = path.join(moduleInfo.path, '/**/*.*');

   return function copy() {
      return gulp.src(moduleInput)
         .pipe(changedInPlace(changesStore, moduleInfo.path))
         .pipe(addComponetInfo(moduleInfo))
         .pipe(buildStaticHtml(moduleInfo))
         .pipe(gulpRename(file => {
            file.dirname = transliterate(file.dirname);
            file.basename = transliterate(file.basename);
         }))
         .pipe(createRoutesInfoJson(moduleInfo))
         .pipe(createContentsJson(moduleInfo))
         .pipe(gulp.dest(moduleInfo.output));
   };
};

const htmlTmplTaskGenerator = function(moduleInfo) {
   const moduleInput = path.join(moduleInfo.path, '/**/*.html.tmpl');

   return function htmlTmpl() {
      return gulp.src(moduleInput)

      //.pipe(changedInPlace(changesStore, module.path))
         .pipe(gulpHtmlTmpl(moduleInfo))
         .pipe(gulpRename(file => {
            file.dirname = transliterate(file.dirname);
            file.basename = transliterate(file.basename);
            file.extname = ''; // *.html.tmpl => *.html
         }))
         .pipe(gulp.dest(moduleInfo.output));
   };
};

module.exports = {
   'create': function buildTask(config) {
      const buildTasks = [],
         changesStore = new ChangesStore(config.cachePath);

      for (let moduleInfo of config.modules) {
         buildTasks.push(
            gulp.parallel(
               copyTaskGenerator(moduleInfo, changesStore),
               htmlTmplTaskGenerator(moduleInfo, changesStore)));
      }
      const clearTask = function remove(done) {
         let pattern = [];

         for (let modulePath in changesStore.store) {
            if (changesStore.store.hasOwnProperty(modulePath)) {
               if (!changesStore.store[modulePath].exist) {
                  pattern.push(transliterate(path.join(path.basename(modulePath)), '/**/*.*'));
               } else {
                  let files = changesStore.store[modulePath]['files'];
                  for (let filePath in files) {
                     if (files.hasOwnProperty(filePath)) {
                        let fileInfo = files[filePath];
                        if (!fileInfo.hasOwnProperty('exist')) {
                           const moduleName = path.basename(modulePath);
                           pattern.push(transliterate(path.join(moduleName, filePath)));
                        }
                     }
                  }
               }
            }
         }
         if (pattern.length) {
            return gulp.src(pattern, {read: false, cwd: config.output, allowEmpty: true})
               .pipe(clean());
         } else {
            done();
         }
      };


      const saveChangedStoreTask = function saveChangedStore(done) {
         changesStore.save();
         done();
      };

      return gulp.series(
         gulp.parallel(buildTasks),
         gulp.parallel(clearTask, saveChangedStoreTask));
   }
};
