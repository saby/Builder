/* /InterfaceModule1/extend.package.json:superbundle-for-builder-tests.package.js */
(function(){define('css!InterfaceModule1/moduleStyle',['css!WS.Core/superbundle-for-builder-tests.package'],'');})();
define("InterfaceModule1/library",["require","exports"],(function(e,t){Object.defineProperty(t,"__esModule",{value:true}),t["InterfaceModule1/_private/module1"]=true;var r,n=function(){"use strict";var t={},r=function(e,t){Object.defineProperty(t,"__esModule",{value:true});var r=function(){function e(e){this.variables=e}return e}();t.default=r}(e,t);if(r instanceof Function)return r;else if(r&&Object.getPrototypeOf(r)!==Object.prototype)return r;else for(var n in r)if(r.hasOwnProperty(n))t[n]=r[n];return t}();t["InterfaceModule1/_private/module2"]=true;var u,o=function(){"use strict";var t={},r=function(e,t){Object.defineProperty(t,"__esModule",{value:true});var r=function(){function e(e){this.variables=e}return e}();t.default=r}(e,t);if(r instanceof Function)return r;else if(r&&Object.getPrototypeOf(r)!==Object.prototype)return r;else for(var n in r)if(r.hasOwnProperty(n))t[n]=r[n];return t}();function i(){return"test"}return t.Module1=n.default,t.Module2=o.default,t.test=i,t}));
define("InterfaceModule1/amdModule",["css!InterfaceModule1/amdModule"],(function(){return{_moduleName:"InterfaceModule1/amdModule"}}));
/* /InterfaceModule2/extend.package.json:superbundle-for-builder-tests.package.js */
(function(){define('css!InterfaceModule2/moduleStyle',['css!WS.Core/superbundle-for-builder-tests.package'],'');})();
define("InterfaceModule2/amdModule",["css!InterfaceModule2/amdModule"],(function(){return{_moduleName:"InterfaceModule1/amdModule"}}));
/* /InterfaceModule3/extend.package.json:superbundle-for-builder-tests.package.js */
if(typeof window !== "undefined" && window.atob){define('css!InterfaceModule3/amdModule', function() {var style = document.createElement("style"),head = document.head || document.getElementsByTagName("head")[0];style.type = "text/css";style.setAttribute("data-vdomignore", "true");style.appendChild(document.createTextNode(".interfaceModule3_logoDefault{background-image:url(/resources/InterfaceModule3/images/logo-en.svg?x_module=%{MODULE_VERSION_STUB=InterfaceModule3})}"));head.appendChild(style);});}
define("InterfaceModule3/amdModule",["css!InterfaceModule3/amdModule"],(function(){return{_moduleName:"InterfaceModule1/amdModule"}}));
define("InterfaceModule3/amdAnotherModule",[],(function(){return{_moduleName:"InterfaceModule3/amdAnotherModule"}}));