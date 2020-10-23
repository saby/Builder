'use strict';

const fs = require('fs-extra'),
   path = require('path'),
   packageObj = require('./package.json'),
   crypto = require('crypto');

async function recursiveGetAllBuilderFiles(dir) {
   // dirent is a directory entry, it has all needed information about itself
   const dirents = await fs.readdir(dir, { withFileTypes: true });
   const files = await Promise.all(dirents.map((dirent) => {
      const res = path.resolve(dir, dirent.name);
      return dirent.isDirectory() ? recursiveGetAllBuilderFiles(res) : res;
   }));
   return files.flat();
}

/**
 * List of files of builder code that should cause full builder cache reset due to theirs
 * code updates
 * @type {string[]}
 */
const FILES_FOR_BUILDER_HASH = ['/less/', '/templates/', 'compile-less.js', 'build-tmpl.js', 'build-xhtml.js'];

async function getBuilderCodeHash(filesList) {
   const filesContent = await Promise.all(
      filesList
         .filter((currentFile) => {
            const prettyPath = currentFile.replace(/\\/g, '/');
            let isNeeded = false;
            FILES_FOR_BUILDER_HASH.forEach((mask) => {
               if (prettyPath.includes(mask)) {
                  isNeeded = true;
               }
            });
            return isNeeded;
         })
         .map(currentFile => fs.readFile(currentFile, 'utf8'))
   );
   return crypto
      .createHash('sha1')
      .update(filesContent.join('\n'))
      .digest('base64');
}

async function copyToDest() {
   const dest = path.join(__dirname, 'dest');
   if (await fs.pathExists(dest)) {
      await fs.remove(dest);
   }
   await fs.ensureDir(dest);

   /**
    * use "files" option from package.json for copying of files to be as standard
    * as it can be and to have a proper work of no-unpublished-require checking
    */
   await Promise.all(
      packageObj.files.map(
         fileOrDir => fs.copy(path.join(__dirname, fileOrDir), path.join(dest, fileOrDir))
      )
   );

   // package-lock.json is needed by npm ci. It's safer and faster than npm i.
   await Promise.all(['package.json', 'package-lock.json'].map(async(packageJsonName) => {
      const srcPathPackageJson = path.join(__dirname, packageJsonName);
      const destPathPackageJson = path.join(dest, packageJsonName);
      let textPackageJson = await fs.readFile(srcPathPackageJson, 'utf8');
      if (process.env.hasOwnProperty('BUILD_NUMBER')) {
         textPackageJson = textPackageJson.replace('BUILD', process.env.BUILD_NUMBER);
      }
      await fs.writeFile(destPathPackageJson, textPackageJson);
   }));

   const results = await recursiveGetAllBuilderFiles(path.join(process.cwd(), 'dest'));
   const builderHash = await getBuilderCodeHash(results);
   await fs.writeFile(path.join(process.cwd(), 'dest', 'builderHashFile'), builderHash);
   return results;
}

return copyToDest();
