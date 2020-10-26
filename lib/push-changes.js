'use strict';
const logger = require('./logger').logger();
const https = require('http');

// performs a POST request to server.
function httpPost({ body, ...options }) {
   return new Promise((resolve, reject) => {
      const req = https.request({
         method: 'POST',
         ...options,
      }, (res) => {
         res.on('data', data => process.stdout.write(data));
         res.on('end', resolve);
      });
      req.on('error', reject);

      if (body) {
         req.write(body);
      }
      req.end();
   });
}

/**
 * Function to push changed files onto the server
 * @param taskParameters
 * @returns {Promise<void>}
 */
module.exports = async function pushChanges(taskParameters) {
   if (taskParameters.cache.isFirstBuild()) {
      logger.info('It\'s a first build of project. Thus, there are no changes to be pushed onto server.');
      return;
   }
   const [hostname, port] = taskParameters.config.staticServer.split(':');
   const changedModules = [...taskParameters.changedModules];
   try {
      await httpPost({
         hostname,
         port,
         path: '/push',
         headers: {
            'Content-Type': 'application/json'
         },
         body: JSON.stringify({
            event: 'modules-changed',
            data: changedModules
         })
      });
   } catch (error) {
      logger.warning(`Something wrong is happened during push of changes onto the server ${changedModules}`);
      logger.warning(error);
   }
};
