'use strict';

const path           = require('path');
const through2       = require('through2');
const gutil          = require('gulp-util');
const PluginError    = gutil.PluginError;
const VFile          = require('vinyl');
const minimatch      = require('minimatch');
const argv           = require('yargs').argv;
const esprima        = require('esprima');
const estraverse     = require('estraverse');
const assign         = require('object-assign');
const translit       = require('../lib/utils/transliterate');
// const applySourceMap = require('vinyl-sourcemaps-apply');

/* SUB TASKS */
const contentsIsModuleJs    = require('./subTasks/01-contentsIsModuleJs');
const staticHtml            = require('./subTasks/02-static-html');
const deanonymize           = require('./subTasks/03-deanonymize');
const collectDependencies   = require('./subTasks/05-collect-dependencies');
const routeSearch           = require('./subTasks/06-routes-search');

let needDeanonymize         = false;
let needCollectDependencies = false;
let needRouteSearch         = false;

let files = [];

module.exports = opts => {
    opts = assign({}, {
        acc: null // файлы, которые добавлять в аккумулятор
        // contents: null
    }, opts);

    return through2.obj(
        function (file, enc, cb) {
            if (file.isNull() || !('.js' === path.extname(file.relative))) return cb(null, file);
            if (file.isStream()) return cb(new PluginError('gulp-sbis-traverse', 'Streaming not supported'));
            if (!opts.acc) return cb(new PluginError('gulp-sbis-traverse', 'acc option is required'));
            let ast;
            try {
                ast = esprima.parse(file.contents.toString('utf8'));
            } catch (err) {
                cb(err);
            }

            let isModuleJs = /\.module\.js$/.test(file.relative);

            let patterns = [
                'resources/**/*.js',
                '!resources/**/*.test.js',
                '!resources/**/*.routes.js',
                '!resources/**/*.worker.js',
                '!resources/**/design/**/*.js',
                '!resources/**/node_modules/**/*.js',
                '!resources/**/service/**/*.js'
            ];
            let isStaticHtml = validateFile(path.join('resources', file.relative), patterns);
            let staticHtmlData;

            if (isStaticHtml) {
                staticHtmlData = {
                    arrExpr: [],
                    ReturnStatement: null,
                    moduleName: ''
                }
            }

            let isDeanonymize = [
                '**/*.js',
                '!**/*.test.js',
                '!**/*.routes.js',
                '!**/*.worker.js',
                '!**/design/**/*.js',
                '!**/node_modules/**/*.js',
                '!**/service/**/*.js'
            ].every(glob => minimatch(file.path, glob));

            let collectDeps = [
                // '**/{Модули интерфейса,ws}/**/*.js',
                '**/*.js',
                '!**/*.test.js',
                '!**/*.routes.js',
                '!**/*.worker.js',
                '!**/design/**/*.js',
                '!**/node_modules/**/*.js',
                '!**/service/**/*.js'
            ].every(glob => minimatch(file.path, glob)) && !/ws[\/\\]lib[\/\\]Control[\/\\]\w+[\/\\]demo[\/\\]/i.test(file.path);
            if (collectDeps) needCollectDependencies = true;

            // let routesearch = minimatch(file.path, '**/{Модули интерфейса,ws}/**/*.routes.js');
            let routesearch = minimatch(file.path, '**/*.routes.js');
            if (routesearch) {
                opts.acc.markAsRoute(file.path);
                opts.acc.addAst(file.path, ast);
                needRouteSearch = true;
            }
            let accFile = opts.acc.getFile(file.path);

            if (!accFile) { // А ВДРУГ...
                accFile = {
                    __WS: /[\/\\]ws[\/\\]/i.test(file.path),
                    base: file.base + '',
                    path: file.path + '',
                    relative: file.relative + '',
                    dest: /[\/\\]ws[\/\\]/i.test(file.path) ? path.join(argv.root, 'ws', file.relative) : path.join(argv.root, argv.application,  'resources', translit(file.relative)),
                    contents: file.contents.toString('utf8')
                };
            }

            estraverse.traverse(ast, {
                enter: function (node) {
                    if (node.type == 'CallExpression' && node.callee.type == 'Identifier' && node.callee.name == 'define') {
                        if (node.arguments[0].type == 'Literal' && typeof node.arguments[0].value == 'string') {
                            if (isModuleJs) contentsIsModuleJs({ acc: opts.acc, node: node, contents: opts.acc.contents, file: { base: file.base, relative: file.relative } });
                        }
                    }

                    if (isStaticHtml) {
                        staticHtml.traverse({
                            acc: opts.acc,
                            node: node,
                            contents: opts.acc.contents,
                            data: staticHtmlData,
                            file: { base: file.base, relative: file.relative }
                        });
                    }

                    if (isDeanonymize) {
                        deanonymize.anonymousCheck({
                            acc: opts.acc,
                            node: node,
                            file: { base: file.base, relative: file.relative, path: file.path }
                        })
                    }

                    if (collectDeps) {
                        collectDependencies.traverse({
                            node: node,
                            acc: opts.acc,
                            file: {
                                base: file.base,
                                relative: file.relative,
                                path: file.path,
                                dest: accFile.dest
                            }
                        })
                    }

                }
            });

            if (isStaticHtml && Array.isArray(staticHtmlData.arrExpr) && staticHtmlData.arrExpr.length && staticHtmlData.ReturnStatement) {
                files = staticHtml.execute({
                    acc: opts.acc,
                    data: staticHtmlData,
                    file: { base: file.base, relative: file.relative },
                    moduleName: staticHtmlData.moduleName
                });
            }
            if (file.path.endsWith('.xml.deprecated')) {
                staticHtml.xmlDeprecated({
                    acc: opts.acc,
                    file: file
                });
            } /*else if (file.path.endsWith('.html.deprecated')) { // TODO: не нашел ни одного файла *.html.deprecated, навверное уже не актуально...
                staticHtml.htmlDeprecated({
                    acc: opts.acc,
                    file: file
                });
            }*/

            if (isDeanonymize && accFile && accFile.__anonymous) {
                needDeanonymize = true;
                return cb(null);
            }

            cb(null, file);
        },
        function (cb) {
            // var appContents = require(path.join(root, resourceRoot, 'contents.json'));
            // require('grunt-wsmod-packer/lib/node-ws')();

            // FIXME: из-за JSON.parse(JSON.stringify(opts.acc.contents) теряется 1 сек при watcher-е это типа костыль иммутабельности, инача $ws изменить значение т.к. передаем по ссылке
            global.$ws.core.loadContents(JSON.parse(JSON.stringify(opts.acc.contents)), false, { service: argv.application });

            if (needDeanonymize) {
                deanonymize.execute({ acc: opts.acc });
                let _acc = opts.acc.acc;
                for (let accPath in _acc) {
                    if (_acc[accPath] && _acc[accPath].__anonymous) {
                        let newFile = new VFile({
                            base: _acc[accPath].base,
                            path: _acc[accPath].path,
                            contents: Buffer.from(_acc[accPath].contents)
                        });
                        this.push(newFile);
                        opts.acc.unMarkAsAnonymous(accPath);

                        if (needCollectDependencies) {
                            let ast = esprima.parse(_acc[accPath].contents);
                            estraverse.traverse(ast, {
                                enter: function (node) {
                                    collectDependencies.traverse({
                                        node: node,
                                        acc: opts.acc,
                                        file: {
                                            base: _acc[accPath].base,
                                            relative: _acc[accPath].relative,
                                            path: _acc[accPath].path,
                                            dest: _acc[accPath].dest
                                        }
                                    });
                                }
                            });
                        }
                    }
                }
                needDeanonymize = false;
            }

            if (needCollectDependencies) collectDependencies.execute({ acc: opts.acc });

            if (needRouteSearch) {
                let _acc = opts.acc.acc;
                for (let accPath in _acc) {
                    if (_acc[accPath] && _acc[accPath].__route && _acc[accPath].__ast) {
                        estraverse.traverse(_acc[accPath].__ast, {
                            enter: function (node) {
                                routeSearch.traverse({
                                    node: node,
                                    acc: opts.acc,
                                    file: {
                                        base: _acc[accPath].base,
                                        relative: _acc[accPath].relative,
                                        path: _acc[accPath].path,
                                        dest: _acc[accPath].dest
                                    }
                                });
                            }
                        });

                        opts.acc.unMarkAsRoute(_acc[accPath].path);
                    }
                }

                needRouteSearch = false;
            }
            let contentsJSON = new VFile({
                // cwd base path contents
                base: path.join(argv.root, 'resources'),
                path: path.join(argv.root, 'resources', 'contents.json'),
                contents: new Buffer(JSON.stringify(opts.acc.contents))
            });
            let contentsJS = new VFile({
                // cwd base path contents
                base: path.join(argv.root, 'resources'),
                path: path.join(argv.root, 'resources', 'contents.js'),
                contents: new Buffer('contents=' + JSON.stringify(opts.acc.contents))
            });
            let deanonymizeData = new VFile({
                // cwd base path contents
                base: path.join(argv.root, 'resources'),
                path: path.join(argv.root, 'resources', 'deanonymizeData.json'),
                contents: new Buffer(JSON.stringify(opts.acc.deanonymizeData))

            });
            let moduleDependenciesJSON = new VFile({
                // cwd base path contents
                base: path.join(argv.root, 'resources'),
                path: path.join(argv.root, 'resources', 'module-dependencies.json'),
                contents: new Buffer(opts.acc.graph.toJSON())
            });
            let routesInfoJSON = new VFile({
                // cwd base path contents
                base: path.join(argv.root, 'resources'),
                path: path.join(argv.root, 'resources', 'routes-info.json'),
                contents: new Buffer(JSON.stringify(opts.acc.routesInfo))
            });
            contentsJSON.__MANIFEST__               = true;
            contentsJS.__MANIFEST__                 = true;
            deanonymizeData.__MANIFEST__            = true;
            moduleDependenciesJSON.__MANIFEST__     = true;
            routesInfoJSON.__MANIFEST__             = true;

            if (Array.isArray(files) && files.length) {
                files.forEach(file => {
                    let newFile = new VFile({
                        base: file.base,
                        path: file.path,
                        contents: Buffer.from(file.contents),
                        __STATIC__: true
                    });
                    this.push(newFile);
                });
                files = [];
            }

            this.push(contentsJSON);
            this.push(contentsJS);
            this.push(deanonymizeData);
            this.push(moduleDependenciesJSON);
            this.push(routesInfoJSON);
            cb();
        }
    )
};

function validateFile (file, patterns) {
    let passed = false;

    for (let i = 0, l = patterns.length; i < l; i++) {
        let pattern = patterns[i];
        let neg = pattern.charAt(0) === '!';

        if (minimatch(file, pattern)) {
            if (!neg) {
                passed = true;
            }
        } else {
            if (neg) {
                passed = false;
                break;
            }
        }
    }

    return passed;
}