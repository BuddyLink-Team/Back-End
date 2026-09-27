import jwt from 'jsonwebtoken';

/**
 * Generate a mock JWT bearer token for test requests.
 *
 * @param {object} payload
 * @param {string} [payload.id='test_user_id']
 * @param {string} [payload.role='parent']
 * @returns {string} Bearer token string
 */
export function generateTestToken(payload = {}) {
  const secret = process.env.JWT_SECRET || 'test_jwt_secret_key_buddylink_123456';
  const defaultPayload = {
    id: 'test_user_id',
    role: 'parent',
    ...payload,
  };
  return jwt.sign(defaultPayload, secret, { expiresIn: '1h' });
}

export default { generateTestToken };
