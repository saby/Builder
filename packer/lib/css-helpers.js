'use strict';

const path = require('path');
const postcss = require('postcss');
const postcssUrl = require('postcss-url');
const safe = require('postcss-safe-parser');
const logger = require('../../lib/logger').logger();
const helpers = require('../../lib/helpers');
const invalidUrl = /^(\/|#|data:|[a-z]+:\/\/)(?=.*)/i;

function rebaseUrlsToAbsolutePath(cssConfig) {
   const {
      root,
      sourceFile,
      css,
      relativePackagePath,
      resourcesUrl
   } = cssConfig;
   let result;

   const rootForRebase = path.join(root, relativePackagePath);
   try {
      result = postcss()
         .use(
            postcssUrl({
               url(asset, dir) {
                  // ignore absolute urls, hashes or data uris
                  if (invalidUrl.test(asset.url)) {
                     return asset.url;
                  }

                  /**
                   * path to style can be joined in 2 different ways:
                   * 1) for local demo-examples(f.e. controls) - site root + relative link by site root
                   * 2) for ordinary stand - site root + resources + relative link by site root
                   * A normalized relative path will be returned according to these facts.
                   */
                  return `${resourcesUrl ? 'resources/' : ''}${helpers.prettifyPath(
                     path.relative(
                        dir.to,
                        path.join(dir.from, asset.url)
                     )
                  )}`;
               }
            })
         )
         .process(css, {
            parser: safe,
            from: sourceFile,
            to: rootForRebase
         }).css;
   } catch (e) {
      logger.warning({
         message: 'Failed to parse CSS file.',
         filePath: sourceFile,
         error: e
      });
      result = '';
   }

   return result;
}

module.exports = {
   rebaseUrls: rebaseUrlsToAbsolutePath
};
