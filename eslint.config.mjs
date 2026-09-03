import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['error', 'always'],
      'no-throw-literal': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
      },
    },
    rules: {
      'no-regex-spaces': 'off',
    },
  },
];
