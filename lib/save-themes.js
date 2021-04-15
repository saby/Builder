/**
 * Helpers for saving themes.
 * @author Kolbeshin F.A.
 */

'use strict';
const pMap = require('p-map');
const path = require('path');
const fs = require('fs-extra');

/**
 * Reads each theme part content and joins it into common
 * theme content
 * @param{String} root - current application root
 * @param{String|null}fileSuffix - current file suffix. It's null by default
 * @param{Array} files - list of current theme parts
 * @returns {Promise<void>}
 */
async function getJoinedThemeContent(root, fileSuffix, files) {
   const content = [];
   await pMap(
      files,
      async(file) => {
         const fileContent = await fs.readFile(
            path.join(root, `${file}${fileSuffix || ''}.css`),
            'utf8'
         );
         content.push(`/* ${file} */\n${fileContent}`);
      }
   );
   return content.join('\n');
}

/**
 * Generates themes for current project from
 * each theme parts by themes meta
 * @param{String} root - current application root
 * @param{boolean} isThemeForReleaseOnly - a sign are there should be saved only minimized css themes
 * @param{String} fileSuffix - suffix for file if needed
 * (for release and debug mode it is '.min' and '' respectively)
 * @param{Object} themes - all meta information about
 * themes in current building project
 * @param{String} resourceRoot - current value of resourceRoot variable
 * @returns {Promise<void>}
 */
async function generateJoinedThemes(root, isThemeForReleaseOnly, fileSuffix, themes, resourceRoot) {
   const RESOURCE_ROOT_REG = /%\{RESOURCE_ROOT\}/g;
   await pMap(
      Object.keys(themes),
      async(currentTheme) => {
         if (!isThemeForReleaseOnly) {
            const debugContent = await getJoinedThemeContent(root, '', themes[currentTheme]);
            await fs.outputFile(
               path.join(root, 'themes', `${currentTheme}.css`),
               debugContent.replace(RESOURCE_ROOT_REG, resourceRoot)
            );
         }
         if (typeof fileSuffix === 'string') {
            const releaseContent = await getJoinedThemeContent(root, fileSuffix, themes[currentTheme]);
            await fs.outputFile(
               path.join(root, 'themes', `${currentTheme}${fileSuffix}.css`),
               releaseContent.replace(RESOURCE_ROOT_REG, resourceRoot)
            );
         }
      }
   );
}

module.exports = generateJoinedThemes;
