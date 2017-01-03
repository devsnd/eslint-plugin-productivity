'use strict';

var allRules = {
  'auto-import-hack': require('./auto-import-hack'),
};

module.exports = {
  rules: allRules,
  configs: {
    recommended: {
      plugin: [
        'productivity'
      ],
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      rules: {
        'productivity/auto-import-hack': 2,
      }
    },
    all: {
      plugin: [
        'productivity'
      ],
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      rules: {
        'productivity/auto-import-hack': 2,
      }
    }
  }
};
