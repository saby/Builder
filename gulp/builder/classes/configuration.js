/* eslint-disable no-sync */

/**
 * @author Kolbeshin F.A.
 */

'use strict';

const path = require('path');
const fs = require('fs-extra');
const ConfigurationReader = require('../../common/configuration-reader');
const ModuleInfo = require('./module-info');
const { getLanguageByLocale, clearSourcesSymlinks, checkForSourcesOutput } = require('../../../lib/config-helpers');
const availableLanguage = require('../../../resources/availableLanguage.json');

/**
 * Class with data about configuration of the build.
 */
class BuildConfiguration {
   constructor(nativeWatcher) {
      // path to the configuration file
      this.configFile = '';

      // ordinary configuration data to be used in changes store for getting a solution about builder cache reset.
      this.rawConfig = {};

      // objects list of full information about every single interface module of the building project
      this.modules = [];

      // modules for patch - when we need to rebuild part of project modules instead of full rebuild.
      this.modulesForPatch = [];

      // path to the folder of builder cache
      this.cachePath = '';

      // path to the folder of the build results.
      this.outputPath = '';

      // list of supported locales
      this.localizations = [];

      // default locale
      this.defaultLocalization = '';

      // replace some variables in static html pages in case of project not to be multi-service
      this.multiService = false;

      // Current service relative url
      this.urlServicePath = '';

      /**
       * BL service relative url. Using by desktop-application to set a specific location for theirs BL-service.
       * F.e. retail-offline has "/RetailOffline/" as catalog for BL-service, but desktop applications have "/" for UI.
       */
      this.urlDefaultServicePath = '';

      // compiled content version
      this.version = '';

      // logs output directory
      this.logFolder = '';

      // run typescript compilation
      this.typescript = false;

      // run less compilation
      this.less = false;

      // build common meta information for Presentation Service
      this.presentationServiceMeta = false;

      // generate "contents" for application's work
      this.contents = false;

      // build static html pages based on Vdom/WS4
      this.htmlWml = false;

      // build dynamic templates to AMD-type javascript code.
      this.wml = false;

      // build static html pages based on component's Webpage options. Option is deprecated.
      this.deprecatedWebPageTemplates = false;

      // build old xml-type dynamic templates to AMD-type javascript code. Option is deprecated.
      this.deprecatedXhtml = false;

      // pack component's own dependencies. Option is deprecated.
      this.deprecatedOwnDependencies = false;

      // pack static html entry points to static packages.
      this.deprecatedStaticHtml = false;

      // minify sources and compiled modules
      this.minimize = false;

      // generate packages based on custom developer's configuration
      this.customPack = false;

      // generate project dependencies tree meta
      this.dependenciesGraph = false;

      // compress sources to gzip and brotli formats
      this.compress = false;

      // join module's meta files into common root meta file
      this.joinedMeta = false;

      // enable tsc compiler with "noEmit" flag(compile without saving - for errors check)
      this.tsc = false;

      // copy sources to output directory
      this.sources = true;

      // paste "resources" prefix to links
      this.resourcesUrl = true;

      // make symlinks for source files
      this.symlinks = true;

      // clear output directory
      this.clearOutput = true;

      // enable autoprefixer postprocessor in less compiler
      this.autoprefixer = true;

      // enable core typescript compilation and initialize for gulp plugins
      this.initCore = false;

      /**
       * inline scripts in static html pages. If flag takes value of false, replace those scripts to
       * separated javascript files, which will be containing the content of sliced inline script.
       * Otherwise return html page content as is.
       */
      this.inlineScripts = true;

      // use hash by content instead of file timestamp.
      this.hashByContent = true;

      // native watcher executing state. If true,
      // source modules symlinks can't be recreated, because watcher watches theirs directories
      this.nativeWatcher = !!nativeWatcher;
   }

   /**
    * Configuring all common flags for Builder plugins
    */
   configureBuildFlags() {
      // write all bool parameters of readed config. Builder will use only known flags.
      Object.keys(this.rawConfig).forEach((currentOption) => {
         if (this.rawConfig.hasOwnProperty(currentOption) && typeof this.rawConfig[currentOption] === 'boolean') {
            this[currentOption] = this.rawConfig[currentOption];
         }
      });

      // autoprefixer option - input value can be bollean or object
      if (this.rawConfig.hasOwnProperty('autoprefixer')) {
         const { autoprefixer } = this.rawConfig;
         switch (typeof autoprefixer) {
            case 'boolean':
               this.autoprefixer = autoprefixer;
               break;
            case 'object':
               if (!(autoprefixer instanceof Array)) {
                  this.autoprefixer = autoprefixer;
               }
               break;
            default:
               break;
         }
      }

      if (this.rawConfig.hasOwnProperty('checkModuleDependencies')) {
         const { checkModuleDependencies } = this.rawConfig;
         if (typeof checkModuleDependencies === 'boolean' || typeof checkModuleDependencies === 'string') {
            this.checkModuleDependencies = checkModuleDependencies;
         }
      }
   }

   /**
    * returns build mode in depend on
    * given Gulp configuration's flags
    * @returns {string}
    */
   getBuildMode() {
      const packingEnabled = this.deprecatedOwnDependencies || this.customPack || this.deprecatedStaticHtml;

      // if we are getting packing task as input, minimization should be enabled
      if (packingEnabled && !this.minimize) {
         this.minimize = true;
      }

      return this.minimize || packingEnabled ? 'release' : 'debug';
   }

   // Configure of main info for current project build.
   configMainBuildInfo() {
      const startErrorMessage = `Configuration file ${this.configFile} isn't valid.`;

      // version есть только при сборке дистрибутива
      if (this.rawConfig.hasOwnProperty('version') && typeof this.rawConfig.version === 'string') {
         this.version = this.rawConfig.version;
      }

      this.configureBuildFlags();
      this.cachePath = this.rawConfig.cache;
      this.isReleaseMode = this.getBuildMode() === 'release';

      if (!this.isReleaseMode) {
         this.outputPath = this.rawConfig.output;
      } else {
         /**
          * Some of builder tasks for building of the distributive aren't compatible with incremental build.
          * Therefore project'll be built into the cache folder and copy results into the targeting directory then.
          */
         this.outputPath = path.join(this.cachePath, 'incremental_build');

         // always enable tsc compiler in release mode
         this.tsc = true;
      }

      // localization может быть списком или false
      const hasLocalizations = this.rawConfig.hasOwnProperty('localization') && !!this.rawConfig.localization;

      // default-localization может быть строкой или false
      const hasDefaultLocalization =
         this.rawConfig.hasOwnProperty('default-localization') && !!this.rawConfig['default-localization'];

      if (hasDefaultLocalization !== hasLocalizations) {
         throw new Error(`${startErrorMessage} default localization was specified, but there is no locales list in build config. Please, specify it.`);
      }

      if (hasLocalizations) {
         this.localizations = this.rawConfig.localization;
         const defaultLocalizationsToPush = new Set();
         for (const currentLocale of this.localizations) {
            if (!availableLanguage.hasOwnProperty(currentLocale)) {
               throw new Error(`${startErrorMessage} This locale is not permitted: ${currentLocale}`);
            }
            const commonLocale = currentLocale.split('-').shift();
            if (!availableLanguage.hasOwnProperty(currentLocale)) {
               throw new Error(`${startErrorMessage} This default localization is not permitted: ${currentLocale}`);
            }

            // There is nothing to do if default locale has already been declared
            if (commonLocale !== currentLocale) {
               defaultLocalizationsToPush.add(commonLocale);
            }
         }

         // add common locales to locales list
         this.localizations = this.localizations.concat(...defaultLocalizationsToPush);

         this.defaultLocalization = this.rawConfig['default-localization'];
         if (!availableLanguage.hasOwnProperty(this.defaultLocalization)) {
            throw new Error(
               `${startErrorMessage} There is an incorrect identity of localization by default: ${
                  this.defaultLocalization
               }`
            );
         }

         if (!this.localizations.includes(this.defaultLocalization)) {
            throw new Error(`${startErrorMessage} default locale isn't included into locales list`);
         }
      }

      const isSourcesOutput = checkForSourcesOutput(this.rawConfig);
      if (isSourcesOutput) {
         this.isSourcesOutput = isSourcesOutput;
      }

      this.needTemplates = this.rawConfig.wml || this.rawConfig.htmlWml || this.rawConfig.deprecatedXhtml;

      this.branchTests = this.rawConfig.cld_name === 'InTest' || this.rawConfig.lessCoverage;

      if (this.rawConfig.hasOwnProperty('logs')) {
         this.logFolder = this.rawConfig.logs;

         /**
          * set Logfolder into gulp process environment to save logger report
          * properly, even for unexpected gulp tasks errors. Exception - fatal process
          * errors(f.e. OOM), that aborts current process and kills any availability of
          * saving some additional info about just happened
           */
         process.env.logFolder = this.rawConfig.logs;
      }

      if (this.rawConfig.hasOwnProperty('multi-service')) {
         this.multiService = this.rawConfig['multi-service'];
      }

      if (this.rawConfig.hasOwnProperty('url-service-path')) {
         this.urlServicePath = this.rawConfig['url-service-path'];
      }

      if (this.multiService && this.urlServicePath) {
         /** Temporarily decision: for multi-service auth application don't add UI-service name into
          * styles URL's. Why we need this? Because of there are 2 projects with the same configuration:
          * SBISDisk and authentication-ps for billing - both of them are multi-service applications, but
          * at the same time "SBISDisk" needs "/shared/" service to be added in their custom packages,
          * on the other hand "authentication-ps for billing" needs URLs without service name.
          * Permanent decision for this situation is to add an opportunity for set special flag in project's
          * s3* configuration files.
          * TODO remove it after task completion.
          * https://online.sbis.ru/opendoc.html?guid=fbf769d7-9879-4c13-8ec2-419374da510f
          */
         if (
            this.urlServicePath.includes('/auth') ||
            this.urlServicePath.includes('/service')
         ) {
            this.applicationForRebase = '/';
         } else {
            this.applicationForRebase = this.urlServicePath;
         }
      } else if (this.urlServicePath && !this.urlServicePath.includes('/service')) {
         this.applicationForRebase = this.urlServicePath;
      } else {
         this.applicationForRebase = '/';
      }

      if (this.rawConfig['url-default-service-path']) {
         this.urlDefaultServicePath = this.rawConfig['url-default-service-path'];
      } else {
         this.urlDefaultServicePath = this.urlServicePath;
      }

      if (this.rawConfig.hasOwnProperty('builderTests')) {
         this.builderTests = this.rawConfig.builderTests;
      }
   }

   /**
    * Configuration loading with using of the utility executing args. Synchronous loading
    * is the only option here because of common build workflow generating afterwards.
    * @param {string[]} argv utility running cli arguments
    */
   loadSync(argv) {
      this.configFile = ConfigurationReader.getProcessParameters(argv).config;
      this.rawConfig = ConfigurationReader.readConfigFileSync(this.configFile, process.cwd());
      this.configMainBuildInfo();
      if (!this.nativeWatcher) {
         clearSourcesSymlinks(this.cachePath);
      }
      const mainModulesForTemplates = {
         View: false,
         UI: false
      };
      for (const module of this.rawConfig.modules) {
         const moduleInfo = new ModuleInfo(
            module.name,
            module.responsible,
            module.path,
            this.outputPath,
            module.required,
            module.rebuild,
            module.depends
         );

         moduleInfo.isUnitTestModule = this.branchTests &&
            (
               module.name.endsWith('Test') ||
               module.name.endsWith('Unit') ||
               module.name.endsWith('Tests')
            );

         if (moduleInfo.rebuild) {
            this.modulesForPatch.push(moduleInfo);
         }

         /**
          * Builder needs "View" and "UI" Interface modules for template's build plugin.
          */
         switch (moduleInfo.name) {
            case 'View':
               mainModulesForTemplates.View = true;
               break;
            case 'UI':
               mainModulesForTemplates.UI = true;
               break;
            default:
               break;
         }
         moduleInfo.symlinkInputPathToAvoidProblems(this.cachePath, true);

         moduleInfo.contents.buildMode = this.getBuildMode();
         if (this.defaultLocalization && this.localizations.length > 0) {
            moduleInfo.contents.defaultLanguage = this.defaultLocalization;
            moduleInfo.contents.availableLanguage = {};
            for (const local of this.localizations) {
               moduleInfo.contents.availableLanguage[local] = getLanguageByLocale(local);
            }
         }
         this.modules.push(moduleInfo);
      }
      if (mainModulesForTemplates.View && mainModulesForTemplates.UI) {
         this.templateBuilder = true;
      }

      /**
       * Typescript compiling and afterward initializing of platform core is needed by builder
       * in this cases:
       * 1) build of templates is enabled.
       * 2) This is builder unit tests execution.
       * 3) localization was enabled for current project.
       */
      this.initCore = this.needTemplates || this.builderTests || this.localizations.length > 0;
   }

   /**
    * build only modules for patch if builder cache exists. Otherwise build whole project
    * to get actual builder cache and all needed meta data for proper creating of interface module
    * patch
     */
   getModulesForPatch() {
      if (fs.pathExistsSync(path.join(this.cachePath, 'builder-info.json'))) {
         return this.modulesForPatch;
      }
      return [];
   }
}

module.exports = BuildConfiguration;
