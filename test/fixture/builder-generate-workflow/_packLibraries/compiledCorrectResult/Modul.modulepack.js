define('Modul/Modul', [
    'tslib',
    'i18n!Modul',
    'UI/Executor',
    'require',
    'exports',
    'css!theme?Modul/_es6/test'
], function (tslib_1, rk, Executor, require, exports) {
    Object.defineProperty(exports, '__esModule', { value: true });
        exports['wml!Modul/_es6/test'] = true;
        var wml_Modul__es6_test;
    var wml_Modul__es6_test_func = function () {
        if (!wml_Modul__es6_test) {
            wml_Modul__es6_test = function () {
                var exports = {};
                var result = function (Executor, rk) {
                    function debug() {
                        debugger;
                    }
                    var thelpers = Executor.TClosure;
                    var deps = Array.prototype.slice.call(arguments);
                    var depsLocal = {};
                    var includedTemplates = {};
                    var templateFunction = function Modul__es6_test(data, attr, context, isVdom, sets) {
                        var forCounter = 0;
                        var templateCount = 0;
                        var key = thelpers.validateNodeKey(attr && attr.key);
                        var defCollection = {
                            id: [],
                            def: undefined
                        };
                        var viewController = thelpers.configResolver.calcParent(this, typeof currentPropertyName === 'undefined' ? undefined : currentPropertyName, data);
                        var markupGenerator = thelpers.createGenerator(isVdom);
                        try {
                            var out = markupGenerator.joinElements([markupGenerator.createTag('div', {
                                    'attributes': { 'class': 'test' },
                                    'events': typeof window === 'undefined' ? {} : {},
                                    'key': key + '0_'
                                }, [], attr, defCollection, viewController)], key, defCollection);
                            if (defCollection && defCollection.def) {
                                out = markupGenerator.chain(out, defCollection, this);
                                defCollection = undefined;
                            }
                        } catch (e) {
                            thelpers.templateError('Modul/_es6/test', e, data);
                        }
                        return out || markupGenerator.createText('');
                    };
                    templateFunction.stable = true;
                    templateFunction.reactiveProps = [];
                    templateFunction.isWasabyTemplate = true;
                    return templateFunction;
                }(Executor, rk);
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
        return wml_Modul__es6_test;
    };
        exports['Modul/_es6/Modul2'] = true;
        var Modul__es6_Modul2;
    var Modul__es6_Modul2_func = function () {
        if (!Modul__es6_Modul2) {
            Modul__es6_Modul2 = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports, tslib_1) {
                    'use strict';
                    Object.defineProperty(exports, '__esModule', { value: true });
                    function prepareOptions(param1, param2) {
                        return tslib_1.__awaiter(this, void 0, void 0, function () {
                            return tslib_1.__generator(this, function (_a) {
                                return [
                                    2,
                                    {
                                        sum: param1 + param2,
                                        tplFn: template
                                    }
                                ];
                            });
                        });
                    }
                    exports.default = prepareOptions;
                }(require, exports, tslib_1, typeof css_theme_Modul__es6_test === 'undefined' ? null : css_theme_Modul__es6_test, wml_Modul__es6_test_func());
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
        return Modul__es6_Modul2;
    };
        exports['Modul/_es5/Module'] = true;
        var Modul__es5_Module;
    var Modul__es5_Module_func = function () {
        if (!Modul__es5_Module) {
            Modul__es5_Module = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports, tslib_1, Modul_2) {
                    'use strict';
                    return {
                        Modul_1: Modul_2,
                        default: Modul_2
                    };
                }(require, exports, tslib_1, Modul__es6_Modul2_func());
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
        return Modul__es5_Module;
    };
        exports['Modul/_es6/Modul'] = true;
        var Modul__es6_Modul;
    var Modul__es6_Modul_func = function () {
        if (!Modul__es6_Modul) {
            Modul__es6_Modul = function () {
                'use strict';
                var exports = {};
                var result = function (require, exports, Module_js_1) {
                    'use strict';
                    Object.defineProperty(exports, '__esModule', { value: true });
                    exports.default = Module_js_1.default;
                    function someTest() {
                        var test1 = 'Тестовое сообщение';
                        return test1;
                    }
                    exports.someTest = someTest;
                }(require, exports, Modul__es5_Module_func());
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
        return Modul__es6_Modul;
    };
    Object.defineProperty(exports, 'default', {
        get: function () {
            var result = Modul__es6_Modul_func().default;
            if (typeof result === 'function' && result.prototype && !result.prototype.hasOwnProperty('_moduleName')) {
                result.prototype._moduleName = 'Modul/Modul:default';
            }
            return result;
        },
        enumerable: true
    });
    exports._packedLibrary = true;
    return exports;
});