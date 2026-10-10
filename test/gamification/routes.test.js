import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function buildValidation() {
  const context = vm.createContext({ console, Number });
  const validations = [];
  const chain = field => {
    const result = { field };
    validations.push(result);
    for (const name of ['isMongoId', 'withMessage', 'optional', 'isString', 'trim']) {
      result[name] = () => result;
    }
    result.custom = fn => {
      result.check = fn;
      return result;
    };
    return result;
  };
  const mocks = {
    'express-validator': { body: chain, param: chain },
  };
  const module = new vm.SourceTextModule(
    await readFile(new URL('../../src/modules/rating-feedback/rating-feedback.validation.js', import.meta.url), 'utf8'),
    { context }
  );
  await module.link(specifier => {
    const exports = mocks[specifier.split('/').at(-1)] || {};
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
      },
      { context }
    );
  });
  await module.evaluate();
  return validations;
}

async function buildRoute() {
  const context = vm.createContext({ console, Number });
  const routes = [];
  const middleware = [];
  const router = {
    use: (...items) => middleware.push(...items),
    get: (path, ...handlers) => routes.push({ path, method: 'GET', handlers }),
    post: (path, ...handlers) => routes.push({ path, method: 'POST', handlers }),
  };
  const mocks = {
    express: { Router: () => router },
    'auth.middleware.js': { authenticate: 'authenticate' },
    'role.middleware.js': { authorizeRoles: () => 'parent-role' },
    'validate.middleware.js': { validate: () => 'validate' },
    'index.js': { USER_ROLES: { PARENT: 'PARENT', ADMIN: 'ADMIN' } },
    'rating-feedback.controller.js': { default: { createRating: () => {}, getPendingRatings: () => {} } },
    'rating-feedback.validation.js': { createRatingValidation: ['validate-rules'] },
  };
  const module = new vm.SourceTextModule(
    await readFile(new URL('../../src/modules/rating-feedback/rating-feedback.route.js', import.meta.url), 'utf8'),
    { context }
  );
  await module.link(specifier => {
    const exports = mocks[specifier.split('/').at(-1)] || {};
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
      },
      { context }
    );
  });
  await module.evaluate();
  return { routes, middleware };
}

test('rating routes require authentication and parent role, with POST validation', async () => {
  const { routes, middleware } = await buildRoute();
  assert.deepEqual(middleware, ['authenticate', 'parent-role']);
  assert.equal(routes.find(r => r.method === 'GET').path, '/ratings/pending');
  const post = routes.find(r => r.method === 'POST');
  assert.equal(post.path, '/:id/ratings');
  assert.equal(post.handlers[0], 'validate');
});

test('rating API rejects strings, decimals, missing values and stars outside 1..5', async () => {
  const validations = await buildValidation();
  const check = validations.find(v => v.field === 'rating').check;
  for (const value of [1, 2, 3, 4, 5]) assert.equal(check(value), true);
  for (const value of ['5', 0, 6, 1.5, null, undefined, NaN, {}, true]) assert.equal(check(value), false);
});
