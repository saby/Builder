/**
 * Набор функций для версионирования статического контента.
 * @author Колбешин Ф.А.
 */
'use strict';
const versionHeader = 'x_module=%{MODULE_VERSION_STUB=%{modulePlaceholder}}';
const path = require('path');
const helpers = require('./helpers');
const logger = require('./logger').logger();
const transliterate = require('./transliterate');

/**
 * placeholders examples:
 * 1) %{RESOURCE_ROOT}, %{WI.SBIS_ROOT} - from html.tmpl and templates for routing
 * 2) {{_options.resourceRoot}}, {{resourceRoot}} - from tmpl, xhtml.
 */
const templatePlaceholders = /^(\/?%?{?{[\w. =]+}}?\/?)/;

const resourcesLink = /^[^/]*\/?resources\//;

/**
 * get correct module name for template's url
 * @param linkPath - current link
 * @returns {string|*}
 */
function getTemplateLinkModuleName(content, linkPath, prettyFilePath, fileBase) {
   let normalizedLink = helpers.removeLeadingSlashes(linkPath);

   if (normalizedLink.startsWith('../') || normalizedLink.startsWith('./')) {
      const root = path.dirname(fileBase);
      const resolvedPath = helpers.unixifyPath(
         path.resolve(
            path.dirname(prettyFilePath),
            linkPath
         )
      );
      const pathWithoutRoot = helpers.removeLeadingSlashes(resolvedPath.replace(root, ''));
      return pathWithoutRoot.split('/').shift();
   }

   // get correct module name for previewer links in templates
   if (normalizedLink.startsWith('previewer')) {
      const noResourcesLinkParts = normalizedLink.replace(/previewer\/?.*?\/resources\//, '').split('/');
      return noResourcesLinkParts.length > 1 ? noResourcesLinkParts.shift() : '';
   }

   // for wsRoot and WI.SBIS_ROOT placeholders we should set moduleName as 'WS.Core'
   if (normalizedLink.includes('wsRoot') || normalizedLink.includes('WI.SBIS_ROOT')) {
      return 'WS.Core';
   }
   if (templatePlaceholders.test(normalizedLink)) {
      normalizedLink = normalizedLink.replace(templatePlaceholders, '');
      const normalizedLinkParts = normalizedLink.split('/');
      return normalizedLinkParts.length > 1 ? normalizedLinkParts.shift() : '';
   }
   if (resourcesLink.test(normalizedLink)) {
      const noResourcesLinkParts = normalizedLink.replace(resourcesLink, '').split('/');
      return noResourcesLinkParts.length > 1 ? noResourcesLinkParts.shift() : '';
   }

   const rootConcatenation = new RegExp(`((resourceroot)|(wsroot))[ ]+\\+[ ]+['"]${linkPath}`, 'i');
   if (rootConcatenation.test(content)) {
      const linkParts = normalizedLink.split('/');
      return linkParts.length > 1 ? linkParts.shift() : '';
   }

   // all remaining links are relative by current file path
   return '';
}

/**
 * get correct module name for style's links
 * @param prettyFilePath - current file path
 * @param linkPath - current link
 * @param fileBase - current file module path
 * @returns {*}
 */
function getStyleLinkModuleName(prettyFilePath, linkPath, fileBase) {
   const moduleName = path.basename(fileBase);
   const root = path.dirname(fileBase);
   if (linkPath.startsWith('../') || linkPath.startsWith('./')) {
      const resolvedPath = helpers.unixifyPath(
         path.resolve(
            path.dirname(prettyFilePath),
            linkPath
         )
      );
      const pathWithoutRoot = helpers.removeLeadingSlashes(resolvedPath.replace(root, ''));
      return pathWithoutRoot.split('/').shift();
   }

   // transliterate resolved module to avoid difference in output name and source name
   return transliterate(moduleName);
}

function checkModuleInDependencies(link, versionModuleName, currentModuleName, moduleInfo) {
   if (versionModuleName !== currentModuleName && !moduleInfo.depends.includes(versionModuleName)) {
      let message;

      /**
       * bad relative link will be resolved to this module name:
       * 1)"home" for nix executors
       * 2)name with ":" - part of hard drive name on windows
       */
      if (versionModuleName === 'home' || versionModuleName.includes(':')) {
         message = `bad relative link ${link}. Check workspace you're linking to. Resolved to: ${versionModuleName}`;
      } else {
         message = `External Interface module "${versionModuleName}" usage in link: ${link} ` +
            `Check for this interface module in dependencies list of module "${currentModuleName}" (.s3mod file).` +
            ` Current dependencies list: [${moduleInfo.depends}]`;
      }
      return {
         error: true,
         message
      };
   }
   return {};
}

function versionizeStyles(file, moduleInfo, paramsForVersion = {}) {
   const { multiService, currentVersion } = paramsForVersion;
   const content = file.contents.toString();
   const currentModuleName = path.basename(moduleInfo.output);
   let errors = false;
   const newText = content.replace(
      /(url\(['"]?)([\w/.\-@%{}]+)(\.svg|\.gif|\.png|\.jpg|\.jpeg|\.css|\.woff2?|\.eot|\.ttf)(\?[\w#]+)?/g,
      (match, partUrl, partFilePath, partExt, extraData) => {
         // ignore cdn
         if (partFilePath.indexOf('cdn/') > -1) {
            return match;
         }
         if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
            file.cdnLinked = true;
            return match;
         }
         file.versioned = true;
         const versionModuleName = getStyleLinkModuleName(
            helpers.unixifyPath(file.path),
            helpers.unixifyPath(partFilePath),
            helpers.unixifyPath(file.base)
         );

         /**
          * WS.Core is dependent on some platform modules depending on WS.Core.
          * Therefore we can ignore this module and prevent cycle dependency issues.
          * Patches technology is not supposed to be used in control's integration tests,
          * so we can also ignore "Intest" interface module in external dependencies checker.
          */
         if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
            const checkResult = checkModuleInDependencies(
               partFilePath,
               versionModuleName,
               currentModuleName,
               moduleInfo
            );

            // dont log errors for urls not existing in source less files
            if (checkResult.error && (!file.lessSource || file.lessSource.includes(partFilePath))) {
               errors = true;
               logger.error({
                  filePath: file.path,
                  moduleInfo,
                  message: checkResult.message
               });
            }
         }
         const currentVersionHeader = versionHeader.replace('%{modulePlaceholder}', versionModuleName);
         let result = `${partUrl}${partFilePath}${partExt}`;
         if (extraData) {
            const remainingHeaders = extraData.slice(1, extraData.length);
            result += `?${currentVersionHeader}`;

            /**
             * In case of multi-service application we are forced to add x_version header to avoid server
             * misunderstanding of which static server should be used for content giving back.
             */
            if (multiService) {
               result += `&x_version=${currentVersion}`;
            }
            result += `${remainingHeaders.startsWith('#') ? '' : '#'}${remainingHeaders}`;
         } else {
            result += `?${currentVersionHeader}`;

            /**
             * In case of multi-service application we are forced to add x_version header to avoid server
             * misunderstanding of which static server should be used for content giving back.
             */
            if (multiService) {
               result += `&x_version=${currentVersion}`;
            }
         }
         return result;
      }
   );
   return {
      errors,
      newText
   };
}

function versionizeTemplates(file, moduleInfo, paramsForVersion = {}) {
   const { multiService, currentVersion } = paramsForVersion;
   const content = file.contents.toString();
   const currentModuleName = path.basename(moduleInfo.output);
   let errors = false;
   const newText = content
      .replace(
         /((?:"|')(?:[A-z]+(?!:\/)|\/|\.\/|%[^}]+}|{{[^{}]+}})[\w{}/+-.]*(?:\.\d+)?(?:{{[^{}]+}})?)(\.svg|\.css|\.gif|\.png|\.jpg|\.jpeg|\.woff2?|\.eot|\.ttf|\.ico)(\?|"|')/gi,
         (match, partFilePath, partExt, remainingPart) => {
            // ignore cdn
            if (partFilePath.indexOf('cdn/') > -1) {
               return match;
            }
            if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
               file.cdnLinked = true;
               return match;
            }
            let versionModuleName = getTemplateLinkModuleName(
               content,
               partFilePath.replace(/^("|')/, ''),
               helpers.unixifyPath(file.path),
               helpers.unixifyPath(file.base)
            );
            if (!versionModuleName) {
               versionModuleName = path.basename(moduleInfo.output);
            }

            /**
             * WS.Core is dependent on some platform modules depending on WS.Core.
             * Therefore we can ignore this module and prevent cycle dependency issues.
             * Patches technology is not supposed to be used in control's integration tests,
             * so we can also ignore "Intest" interface module in external dependencies checker.
             */
            if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
               const checkResult = checkModuleInDependencies(
                  partFilePath,
                  versionModuleName,
                  currentModuleName,
                  moduleInfo
               );
               if (checkResult.error) {
                  errors = true;
                  logger.error({
                     filePath: file.path,
                     moduleInfo,
                     message: checkResult.message
                  });
               }
            }
            let currentVersionHeader = versionHeader.replace('%{modulePlaceholder}', versionModuleName);

            /**
             * In case of multi-service application we are forced to add x_version header to avoid server
             * misunderstanding of which static server should be used for content giving back.
             */
            if (multiService) {
               currentVersionHeader += `&x_version=${currentVersion}`;
            }
            file.versioned = true;
            if (partExt === '.css') {
               // если в пути уже есть .min, то дублировать не нужно
               const partFilePathWithoutMin = partFilePath.replace(/\.min$/, '');
               return `${partFilePathWithoutMin}.min${partExt}?${currentVersionHeader}${remainingPart}`;
            }
            return `${partFilePath}${partExt}?${currentVersionHeader}${remainingPart}`;
         }
      )
      .replace(
         /([\w]+[\s]*=[\s]*)((?:"|')(?:[A-z]+(?!:\/)|\/|(?:\.|\.\.)\/|%[^}]+}|{{[^{}]*}})[\w/+-.]+(?:\.\d+)?)(\.js)/gi,
         (match, partEqual, partFilePath, partExt) => {
            // ignore cdn and data-providers
            if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
               file.cdnLinked = true;
               return match;
            }
            if (
               partFilePath.indexOf('cdn/') > -1 ||
               partFilePath.indexOf('//') === 1 ||
               !/^src|^href/i.test(match) ||
               partFilePath.indexOf('?x_module=') > -1
            ) {
               return match;
            }
            file.versioned = true;
            let versionModuleName = getTemplateLinkModuleName(
               content,
               partFilePath.replace(/^("|')/, ''),
               helpers.unixifyPath(file.path),
               helpers.unixifyPath(file.base)
            );
            if (!versionModuleName) {
               versionModuleName = path.basename(moduleInfo.output);
            }

            /**
             * WS.Core is dependent on some platform modules depending on WS.Core.
             * Therefore we can ignore this module and prevent cycle dependency issues.
             * Patches technology is not supposed to be used in control's integration tests,
             * so we can also ignore "Intest" interface module in external dependencies checker.
             */
            if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
               const checkResult = checkModuleInDependencies(
                  partFilePath,
                  versionModuleName,
                  currentModuleName,
                  moduleInfo
               );
               if (checkResult.error) {
                  errors = true;
                  logger.error({
                     filePath: file.path,
                     moduleInfo,
                     message: checkResult.message
                  });
               }
            }

            // если в пути уже есть .min, то дублировать не нужно
            const partFilePathWithoutMin = partFilePath.replace(/\.min$/, '');

            /**
             * In order to avoid name collisions in multi-service applications with the same domain
             * we have to make links to "bundles" and "contents" unique.
             */
            if (/(}|\/)(bundles|contents)/.test(partFilePathWithoutMin)) {
               return `${partEqual}${partFilePathWithoutMin}.min${partExt}`;
            }
            const currentVersionHeader = versionHeader.replace('%{modulePlaceholder}', versionModuleName);
            return `${partEqual}${partFilePathWithoutMin}.min${partExt}?${currentVersionHeader}`;
         }
      );
   return {
      errors,
      newText
   };
}

module.exports = {
   versionizeStyles,
   versionizeTemplates
};
