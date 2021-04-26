/**
 * Constants for builder cache
 * @author Kolbeshin F.A.
 */
'use strict';

module.exports = {

   // cache of files with its content
   FILE_CONTENTS_CACHE: [
      'markupCache',
      'esCompileCache',
      'svgCache'
   ],

   // common meta about files
   COMMON_CACHE_PROPERTIES: [
      'componentsInfo',
      'routesInfo',
      'versionedModules',
      'cdnModules'
   ]
};
