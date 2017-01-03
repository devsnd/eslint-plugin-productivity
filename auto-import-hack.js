/**
Crazy hack made of other linter modules. This will try to find all imports and
exports so that we can autoimport modules using the --fix switch
*/


'use strict';

var tagConvention = /^[a-z]|\-/;
function isTagName(name) {
  return tagConvention.test(name);
}

var fs = require('fs');

function oswalk(path) {
  var retval = [];
  var list = fs.readdirSync(path);
  list.sort().map(function (filename) {
    var subpath = path + '/' + filename;
    var stat = fs.statSync(subpath);
    if (stat) {
      if (stat.isDirectory()) {
        retval = retval.concat(oswalk(subpath))
      } else {
        retval.push(subpath);
      }
    }
  })
  return retval;
}


// ------------------------------------------------------------------------------
// Rule Definition
// ------------------------------------------------------------------------------


var availableImports = {};
var ambigiousImports = {};

// we assume that the source directory is right next to the node_modules folder
// in which the plugin resides:
// so we leave the current file, the current module and the node_modules folder and append the 'src'
// folder
var currentPathParts = __filename.split('/');
var sourcePath = currentPathParts.slice(0, currentPathParts.length - 3).concat(['src']).join('/');

var files = (
  oswalk(sourcePath)
    .filter(function(filename) {
      return filename.indexOf('.js') === filename.length - 3
    })
);

function importFound (importName, importPath, _default, deduplicate) {
  if (importName in ambigiousImports) {
    ambigiousImports[importName].push(importPath);
    return;
  }
  if (deduplicate) {
    if (importName in availableImports) {
      delete availableImports[importName];
      ambigiousImports[importName] = [importPath];
      return;
    }
  }
  if (!(importName in availableImports)){
    availableImports[importName] = {
      default: _default,
      path: importPath,
    }
  }
}

files.map(function(filename) {
  var lines = fs.readFileSync(filename).toString().split('\n');

  // use semicolons to check for multiline import and export statements.
  // JS's ASI is crazy, so I'll only check code that has proper semicolons set.
  var statements = [];
  var currentStatement = '';
  for (var i=0; i < lines.length; i++) {
    currentStatement += lines[i];
    if (lines[i].indexOf(';') !== -1) {
      statements.push(currentStatement);
      currentStatement = '';
    }
  }
  if (currentStatement !== '') {
    statements.push(currentStatement);
  }

  statements.map(function (line) {
    // parse imports

    // can only parse single line imports for now:
    if(line.trim().indexOf('import') === 0) {
      var match = line.match(/import\s+(.+?)\s+from\s+'([^']+)'\s*;/);
      if (match) {
        var importPath = match[match.length - 1];
        var imports = match[1].split(',');
        var isDefault = true;
        imports.map(function(matchedImport) {
          matchedImport = matchedImport.trim();
          if(matchedImport === '}') {
            return; // there was a comma after the last non default import
          }
          // opening bracket marks start of non default import
          if (matchedImport.indexOf('{') !== 0) {
            isDefault = false;
          }
          var importName = matchedImport.match(/{?\s*(\w+)\s*}?/)[1];
          importFound(importName, importPath, isDefault, false);
          if (matchedImport.indexOf('}') !== 0) {
             isDefault = true;
          }
        })
      }
    }
    // parse exports
    if(line.trim().indexOf('export') === 0) {
      var match = line.match(/\s*export\s+(\w+)\s+(\w+)/)
      if (match !== null) {
        var isDefault = match[1] === 'default'
        var importName;
        var importPath;
        if (isDefault) {
          // we assume that the default exports will always carry the same name as the filename
          var filenameParts = filename.split('/')
          importName = filenameParts[filenameParts.length - 1].slice(0, -3) // remove .js
          importPath = filename.slice(sourcePath.length + 1);  // remove the base directory
          importFound(importName, importPath, isDefault);
        } else {
          importName = match[2];
          importPath = filename.slice(sourcePath.length + 1);  // remove the base directory
          importPath = importPath.slice(0, -3)  // remove '.js'
          importFound(importName, importPath, isDefault);
        }
      }
    }
  });
});

var reportFixIfImportAvailable = function(node, missingImport, context) {
  if (missingImport in availableImports) {
    var availableImport = availableImports[missingImport];
    context.report({
      node: node,
      message: '\'' + missingImport + '\' is not defined, auto import?.',
      fix: function (fixer) {
        if (availableImport.default) {
          return fixer.replaceTextRange(
            [0, 0],
            "import " + missingImport + " from '" + availableImport.path + "'\n"
          );
        } else {
          return fixer.replaceTextRange(
            [0, 0],
            "import {" + missingImport + "} from '" + availableImport.path + "'\n"
          );
        }

      }
    });
  }
}

module.exports = {
  meta: {
    docs: {
      description: 'Auto Import certain classes heurstically',
      category: 'Possible Errors',
      recommended: true
    },
    fixable: 'code',
    schema: []
  },

  create: function (context) {

    /**
     * Compare an identifier with the variables declared in the scope
     * @param {ASTNode} node - Identifier or JSXIdentifier node
     * @returns {void}
     */
    var sourceCode = context.getSourceCode();

    function checkIdentifierInJSX(node) {
      var scope = context.getScope();
      var variables = scope.variables;
      var i;
      var len;

      // Ignore 'this' keyword (also maked as JSXIdentifier when used in JSX)
      if (node.name === 'this') {
        return;
      }

      while (scope.type !== 'global') {
        scope = scope.upper;
        variables = scope.variables.concat(variables);
      }
      if (scope.childScopes.length) {
        variables = scope.childScopes[0].variables.concat(variables);
        // Temporary fix for babel-eslint
        if (scope.childScopes[0].childScopes.length) {
          variables = scope.childScopes[0].childScopes[0].variables.concat(variables);
        }
      }

      for (i = 0, len = variables.length; i < len; i++) {
        if (variables[i].name === node.name) {
          return;
        }
      }

      reportFixIfImportAvailable(node, node.name, context);
    }

    // no-undef
    var options = context.options[0];
    var considerTypeOf = options && options.typeof === true || false;

    function hasTypeOfOperator(node) {
      var parent = node.parent;
      return parent.type === "UnaryExpression" && parent.operator === "typeof";
    }

    // no-undef end

    return {
      JSXOpeningElement: function (node) {
        switch (node.name.type) {
          case 'JSXIdentifier':
            node = node.name;
            if (isTagName(node.name)) {
              return;
            }
            break;
          case 'JSXMemberExpression':
            node = node.name;
            do {
              node = node.object;
            } while (node && node.type !== 'JSXIdentifier');
            break;
          case 'JSXNamespacedName':
            node = node.name.namespace;
            break;
          default:
            break;
        }
        checkIdentifierInJSX(node);
      },
      "Program:exit": function (/* node */) {
        var globalScope = context.getScope();

        globalScope.through.forEach(function (ref) {
          var identifier = ref.identifier;

          if (!considerTypeOf && hasTypeOfOperator(identifier)) {
            return;
          }

          reportFixIfImportAvailable(identifier, identifier.name, context);
        });
      }
    };
  }
}
