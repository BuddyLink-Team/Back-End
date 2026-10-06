module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  extends: ['eslint:recommended'],
  ignorePatterns: ['node_modules/', 'coverage/', 'scripts/'],
  rules: {
    // Express error middlewares need the 4-argument signature even when some args are unused
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-console': 'error',
  },
  overrides: [
    {
      files: ['test/**/*.js'],
      env: { jest: true },
    },
  ],
};
