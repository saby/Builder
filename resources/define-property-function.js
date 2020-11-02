'use strict';

module.exports = {
   type: 'Program',
   body: [
      {
         type: 'FunctionDeclaration',
         id: {
            type: 'Identifier',
            name: 'lazyDefineProperty'
         },
         params: [
            {
               type: 'Identifier',
               name: 'scope'
            },
            {
               type: 'Identifier',
               name: 'name'
            },
            {
               type: 'Identifier',
               name: 'moduleName'
            },
            {
               type: 'Identifier',
               name: 'factory'
            }
         ],
         body: {
            type: 'BlockStatement',
            body: [
               {
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
                           name: 'scope'
                        },
                        {
                           type: 'Identifier',
                           name: 'name'
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
                                                      name: 'e'
                                                   },
                                                   init: {
                                                      type: 'CallExpression',
                                                      callee: {
                                                         type: 'Identifier',
                                                         name: 'factory'
                                                      },
                                                      arguments: []
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
                                                   type: 'LogicalExpression',
                                                   operator: '&&',
                                                   left: {
                                                      type: 'BinaryExpression',
                                                      operator: '===',
                                                      left: {
                                                         type: 'Literal',
                                                         value: 'function',
                                                         raw: '\'function\''
                                                      },
                                                      right: {
                                                         type: 'UnaryExpression',
                                                         operator: 'typeof',
                                                         argument: {
                                                            type: 'Identifier',
                                                            name: 'e'
                                                         },
                                                         prefix: true
                                                      }
                                                   },
                                                   right: {
                                                      type: 'MemberExpression',
                                                      computed: false,
                                                      object: {
                                                         type: 'Identifier',
                                                         name: 'e'
                                                      },
                                                      property: {
                                                         type: 'Identifier',
                                                         name: 'prototype'
                                                      }
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
                                                               name: 'e'
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
                                                            raw: '\'_moduleName\''
                                                         }
                                                      ]
                                                   },
                                                   prefix: true
                                                }
                                             },
                                             consequent: {
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
                                                            name: 'e'
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
                                                      type: 'Identifier',
                                                      name: 'moduleName'
                                                   }
                                                }
                                             },
                                             alternate: null
                                          },
                                          {
                                             type: 'ReturnStatement',
                                             argument: {
                                                type: 'Identifier',
                                                name: 'e'
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
               }
            ]
         },
         generator: false,
         expression: false,
         async: false
      }
   ],
   sourceType: 'script'
};
