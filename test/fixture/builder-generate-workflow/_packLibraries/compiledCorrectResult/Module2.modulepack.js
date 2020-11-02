define('Modul2/Module2', [
    'require',
    'exports',
    'Modul2/_private/notAmd'
], function (require, exports) {
        function lazyDefineProperty(scope, name, moduleName, factory) {
        Object.defineProperty(scope, name, {
            get: function () {
                var e = factory();
                if ('function' === typeof e && e.prototype && !e.prototype.hasOwnProperty('_moduleName'))
                    e.prototype._moduleName = moduleName;
                return e;
            },
            enumerable: true
        });
    }
        exports['Modul2/_private/Module1'] = true;
        var Modul2__private_Module1;
    var Modul2__private_Module1_func = function () {
        if (!Modul2__private_Module1) {
            Modul2__private_Module1 = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports) {
                    'use strict';
                    Object.defineProperty(exports, '__esModule', { value: true });
                    var MyClass = function () {
                        function MyClass(test1, test2) {
                            this.test1 = test1;
                            this.test2 = test2;
                        }
                        Object.defineProperty(MyClass.prototype, 'classArray', {
                            get: function () {
                                return this.test2;
                            },
                            set: function (value) {
                                this.test2 = value;
                            },
                            enumerable: true,
                            configurable: true
                        });
                        return MyClass;
                    }();
                    exports.default = MyClass;
                }(require, exports);
                if (result instanceof Function) {
                    return result;
                } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
                    return result;
                } else {
                    for (var property in result) {
                        if (result.hasOwnProperty(property)) {
                            exports[property] = result[property];
                        }
                    }
                }
                return exports;
            }();
        }
        return Modul2__private_Module1;
    };
        exports['Modul2/_private/withNotAmdImport'] = true;
        var Modul2__private_withNotAmdImport;
    var Modul2__private_withNotAmdImport_func = function () {
        if (!Modul2__private_withNotAmdImport) {
            Modul2__private_withNotAmdImport = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports, Module1_1) {
                    'use strict';
                    Object.defineProperty(exports, '__esModule', { value: true });
                    exports.default = Module1_1.default;
                }(require, exports, Modul2__private_Module1_func(), typeof Modul2__private_notAmd === 'undefined' ? null : Modul2__private_notAmd);
                if (result instanceof Function) {
                    return result;
                } else if (result && Object.getPrototypeOf(result) !== Object.prototype) {
                    return result;
                } else {
                    for (var property in result) {
                        if (result.hasOwnProperty(property)) {
                            exports[property] = result[property];
                        }
                    }
                }
                return exports;
            }();
        }
        return Modul2__private_withNotAmdImport;
    };
    Object.defineProperty(exports, '__esModule', { value: true });
    lazyDefineProperty(exports, 'default', 'Modul2/Module2:default', function () {
        return Modul2__private_withNotAmdImport_func();
    });
    exports._packedLibrary = true;
    return exports;
});