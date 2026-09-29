import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import logger from '../../shared/logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the Firebase service account JSON key
const serviceAccountPath = path.resolve(__dirname, '../../config/firebase-service-account.json');

let firebaseApp = null;
let firebaseAuth = null;

async function getOrInitFirebaseAuth() {
  if (firebaseAuth) return firebaseAuth;

  try {
    if (fs.existsSync(serviceAccountPath)) {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

      const existingApps = getApps();
      if (existingApps.length > 0) {
        firebaseApp = existingApps[0];
      } else {
        firebaseApp = initializeApp({
          credential: cert(serviceAccount),
        });
      }

      firebaseAuth = getAuth(firebaseApp);
      logger.info('[Firebase] Admin SDK initialized successfully');
      return firebaseAuth;
    } else {
      logger.warn(`[Firebase] Service account file not found at: ${serviceAccountPath}`);
    }
  } catch (error) {
    logger.warn(`[Firebase] Could not initialize Firebase Admin SDK: ${error.message}`);
  }
  return null;
}

/**
 * Verify a Firebase ID Token received from client after successful phone OTP verification
 * @param {string} idToken - Firebase JWT token issued by client SDK
 * @returns {Promise<{ phoneNumber: string, uid: string, decodedToken: object }>}
 */
export async function verifyFirebasePhoneToken(idToken) {
  // Support mock verification in test environment
  if (process.env.NODE_ENV === 'test' && idToken.startsWith('mock-firebase-token:')) {
    const [, phone, uid] = idToken.split(':');
    return {
      phoneNumber: phone || '+84988776655',
      uid: uid || `mock-uid-${Date.now()}`,
      decodedToken: { phone_number: phone || '+84988776655', uid: uid || 'test-uid' },
    };
  }

  const authInstance = await getOrInitFirebaseAuth();
  if (!authInstance) {
    throw new Error('Firebase Admin SDK is not initialized. Please verify firebase-service-account.json configuration.');
  }

  const decodedToken = await authInstance.verifyIdToken(idToken);

  if (!decodedToken.phone_number) {
    throw new Error('Firebase token is valid but does not contain a verified phone number');
  }

  return {
    phoneNumber: decodedToken.phone_number,
    uid: decodedToken.uid,
    decodedToken,
  };
}

export default {
  verifyFirebasePhoneToken,
  getAuth: () => firebaseAuth,
  getApp: () => firebaseApp,
};
