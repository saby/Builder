'use strict';

module.exports = {
   type: 'ExpressionStatement',
   expression: {
      type: 'CallExpression',
      callee: {
         type: 'MemberExpression',
         computed: false,
         object: {
            type: 'Identifier',
            name: 'Object'
         },
         property: {
            type: 'Identifier',
            name: 'defineProperty'
         }
      },
      arguments: [
         {
            type: 'Identifier',
            name: 'exports'
         },
         {
            type: 'Literal',
            value: '<name of your property>',
            raw: '"<name of your property>"'
         },
         {
            type: 'ObjectExpression',
            properties: [
               {
                  type: 'Property',
                  key: {
                     type: 'Identifier',
                     name: 'get'
                  },
                  computed: false,
                  value: {
                     type: 'FunctionExpression',
                     id: null,
                     params: [],
                     body: {
                        type: 'BlockStatement',
                        body: [
                           {
                              type: 'VariableDeclaration',
                              declarations: [
                                 {
                                    type: 'VariableDeclarator',
                                    id: {
                                       type: 'Identifier',
                                       name: 'result'
                                    },
                                    init: {
                                       type: 'Identifier',
                                       name: '<name of private packed module>'
                                    }
                                 }
                              ],
                              kind: 'var'
                           },
                           {
                              type: 'IfStatement',
                              test: {
                                 type: 'LogicalExpression',
                                 operator: '&&',
                                 left: {
                                    type: 'BinaryExpression',
                                    operator: '===',
                                    left: {
                                       type: 'UnaryExpression',
                                       operator: 'typeof',
                                       argument: {
                                          type: 'Identifier',
                                          name: 'result'
                                       },
                                       prefix: true
                                    },
                                    right: {
                                       type: 'Literal',
                                       value: 'function',
                                       raw: "function'"
                                    }
                                 },
                                 right: {
                                    type: 'UnaryExpression',
                                    operator: '!',
                                    argument: {
                                       type: 'CallExpression',
                                       callee: {
                                          type: 'MemberExpression',
                                          computed: false,
                                          object: {
                                             type: 'MemberExpression',
                                             computed: false,
                                             object: {
                                                type: 'Identifier',
                                                name: 'result'
                                             },
                                             property: {
                                                type: 'Identifier',
                                                name: 'prototype'
                                             }
                                          },
                                          property: {
                                             type: 'Identifier',
                                             name: 'hasOwnProperty'
                                          }
                                       },
                                       arguments: [
                                          {
                                             type: 'Literal',
                                             value: '_moduleName',
                                             raw: "'_moduleName'"
                                          }
                                       ]
                                    },
                                    prefix: true
                                 }
                              },
                              consequent: {
                                 type: 'BlockStatement',
                                 body: [
                                    {
                                       type: 'ExpressionStatement',
                                       expression: {
                                          type: 'AssignmentExpression',
                                          operator: '=',
                                          left: {
                                             type: 'MemberExpression',
                                             computed: false,
                                             object: {
                                                type: 'MemberExpression',
                                                computed: false,
                                                object: {
                                                   type: 'Identifier',
                                                   name: 'result'
                                                },
                                                property: {
                                                   type: 'Identifier',
                                                   name: 'prototype'
                                                }
                                             },
                                             property: {
                                                type: 'Identifier',
                                                name: '_moduleName'
                                             }
                                          },
                                          right: {
                                             type: 'Literal',
                                             value: '<AMD-name for current exported property>',
                                             raw: "'<AMD-name for current exported property>'"
                                          }
                                       }
                                    }
                                 ]
                              },
                              alternate: null
                           },
                           {
                              type: 'ReturnStatement',
                              argument: {
                                 type: 'Identifier',
                                 name: 'result'
                              }
                           }
                        ]
                     },
                     generator: false,
                     expression: false,
                     async: false
                  },
                  kind: 'init',
                  method: false,
                  shorthand: false
               },
               {
                  type: 'Property',
                  key: {
                     type: 'Identifier',
                     name: 'enumerable'
                  },
                  computed: false,
                  value: {
                     type: 'Literal',
                     value: true,
                     raw: 'true'
                  },
                  kind: 'init',
                  method: false,
                  shorthand: false
               }
            ]
         }
      ]
   }
};
