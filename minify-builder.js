/* eslint-disable no-sync,no-console */
'use strict';

const fs = require('fs-extra'),
   path = require('path');

/**
 * Parse all parameters of current node command
 * @param{Array} argv - arguments from cli for current command
 * @returns Array
 */
function getProcessParameters(argv) {
   const result = {};
   for (const argument of argv) {
      const match = argument.match(/^--([^-=]+)=['"]?([^'"]*)['"]?$/i);
      if (match) {
         // eslint-disable-next-line prefer-destructuring
         result[match[1]] = match[2];
      }
   }
   return result;
}

const processParams = getProcessParameters(process.argv);
let projectDirectory;
if (processParams.directory) {
   projectDirectory = path.join(__dirname, processParams.directory);
} else {
   // eslint-disable-next-line id-match
   projectDirectory = __dirname;
}
const nodeModulesDir = path.join(projectDirectory, 'node_modules');

// все строки в lower case
const filesForRemove = [
   '.eslintrc.yml',
   'license',
   'licence',
   'license.txt',
   'license-mit',
   'license-mit.txt',
   'license.html',
   'license-jsbn',
   'license.bsd',
   '.travis.yml',
   'gruntfile.js',
   '.jshintrc',
   '.npmignore',
   'webpack.config.js',
   'bower.json',
   'makefile',
   '.eslintrc.json',
   'authors',
   '.editorconfig',
   '.eslintignore',
   '.eslintrc',
   'thirdpartynoticetext.txt',
   'copyrightnotice.txt',
   '.mailmap',
   '.jshintignore',
   'changelog',
   '.project',
   'contributors',
   'gulpfile.js',
   '.eslintrc.js',
   '.gitattributes',
   'changes',
   '.lint',
   'usage.txt',
   '.ds_store',
   'appveyor.yml',
   'secret',
   'test.js',
   '.istanbul.yml',
   '.jscs.json',
   '.gitmodules',
   'jsl.node.conf',
   'makefile.targ',
   '.babelrc',
   '.coveralls.yml'
];
const extensionsForRemove = [
   '.md',
   '.markdown',
   '.map',
   '.min.js',
   '.test.js',
   '.log',
   '.svg',
   '.coffee',
   '.h',
   '.html',
   '.bak'
];
const foldersForRemove = ['.bin', '.idea', 'test', 'examples', 'example', '.vscode', '.github'];

const exclusions = [

   // "workerpool" uses minified script for execute(see their's package.json for details). So we can't remove it.
   'workerpool.min.js'
];

function readDevDependencies() {
   const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8')
   );
   return Object.keys(packageJson.devDependencies);
}

// exclude devDependencies from minifier to avoid problems with it in builder unit tests
const librariesToExclude =
   [
      ...readDevDependencies(),

      // needed by eslint with all of it's executable files
      'esquery'
   ];

function recursiveReadDir(folder, results) {
   const files = fs.readdirSync(folder);
   for (const file of files) {
      const filePath = path.join(folder, file);
      const isDir = fs.statSync(filePath).isDirectory();
      const isExcludedLibrary = isDir && librariesToExclude.includes(path.basename(filePath));
      if (!isExcludedLibrary) {
         results.push({ path: filePath, isDir });
         if (isDir) {
            recursiveReadDir(filePath, results);
         }
      }
   }
}

function needRemove(filePath, isDir) {
   const basename = path.basename(filePath).toLowerCase();
   if (isDir) {
      if (foldersForRemove.includes(basename)) {
         return true;
      }
   } else {
      if (exclusions.includes(basename)) {
         return false;
      }
      if (filesForRemove.includes(basename)) {
         return true;
      }
      for (const ext of extensionsForRemove) {
         if (basename.endsWith(ext)) {
            return true;
         }
      }
   }
   return false;
}

const files = [];
recursiveReadDir(nodeModulesDir, files);
for (const file of files) {
   if (needRemove(file.path, file.isDir)) {
      console.log(`remove ${file.path}`);
      fs.removeSync(file.path);
   }
}

if (processParams.directory) {
   // package-lock.json уже не нужен после npm ci
   fs.removeSync(path.join(__dirname, processParams.directory, 'package-lock.json'));
}
