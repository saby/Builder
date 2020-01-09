/**
 * Class with main functions and parameters for platform templates
 * constructor to generate .html.tmpl/.wml/.tmpl files.
 * @author Kolbeshin F.A.
 */

'use strict';

class TemplatesBuilder {
   constructor() {
      // common template's constructor functions. Null by default
      this.tmplControlsApplicationRoute = null;
      this.ViewBuilderTmpl = null;
      this.ViewConfig = null;

      // common wsConfig params. Null by default.
      this.appRoot = null;
      this.wsRoot = null;
      this.resourceRoot = null;
      this.RUMEnabled = null;
      this.pageName = null;
      this.servicesPath = null;
   }

   // requires basic platform needed by .wml/.tmpl/.html.tmpl compiler.
   requireView() {
      if (!this.ViewBuilderTmpl) {
         this.ViewBuilderTmpl = global.requirejs('View/Builder/Tmpl');
      }
      if (!this.ViewConfig) {
         this.ViewConfig = global.requirejs('View/config');
      }
   }

   render(_options) {
      return new Promise((resolve, reject) => {
         global.requirejs(['UI/Base'], (base) => {
            const application = 'UI/_base/HTML';
            const route = base.BaseRoute;
            try {
               resolve(route({
                  servicesPath: this.servicesPath,
                  resourceRoot: this.resourceRoot,
                  RUMEnabled: this.RUMEnabled,
                  pageName: this.pageName,
                  appRoot: this.appRoot,
                  wsRoot: this.wsRoot,
                  application,
                  _options,
               }));
            } catch (e) {
               reject(e);
            }
         }, reject);
      });
   }

   setCommonRootInfo(serviceConfig) {
      /**
       * In case of presentation service usage in current project set wsConfig common parameters
       * with special placeholder to be replaced by PS afterwards. Otherwise default meta with
       * application(configured in builder by gulp_config - applicationForRebase) will be used
       */
      if (!this.appRoot) {
         const { servicesPath, application, multiService } = serviceConfig;
         this.appRoot = multiService ? '%{APPLICATION_ROOT}' : application;
         this.wsRoot = multiService ? '%{WI.SBIS_ROOT}' : `${application}resources/WS.Core/`;
         this.resourceRoot = multiService ? '%{RESOURCE_ROOT}' : `${application}resources/`;
         this.RUMEnabled = multiService ? '%{RUM_ENABLED}' : 'false';
         this.pageName = multiService ? '%{PAGE_NAME}' : '';
         this.servicesPath = multiService ? '%{SERVICES_PATH}' : servicesPath;
      }
   }
}

module.exports = TemplatesBuilder;
