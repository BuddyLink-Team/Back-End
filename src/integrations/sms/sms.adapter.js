import logger from '../../shared/logger/index.js';

/**
 * SmsAdapter
 * Default development/test SMS adapter.
 * For production phone verification, the project uses Firebase Phone Authentication.
 */
class SmsAdapter {
  constructor() {
    logger.info('SMS Adapter running in local console mode. For SMS delivery, use Firebase Phone Auth.');
  }

  /**
   * Send Phone OTP (Mock / Console mode for local testing)
   * @param {Object} param0 
   * @param {string} param0.phone - Phone number
   * @param {string} param0.otp - 6-digit OTP code
   * @param {number} param0.minutes - Expiration time in minutes
   */
  async sendPhoneOtp({ phone, otp, minutes = 5 }) {
    let formattedPhone = phone.trim().replace(/^\+/, '');
    if (formattedPhone.startsWith('840')) {
      formattedPhone = '84' + formattedPhone.slice(3);
    }

    if (process.env.NODE_ENV === 'test') {
      logger.info(`[TEST MOCK SMS] Phone: ${formattedPhone} | OTP: ${otp} | Expires in: ${minutes}m`);
    } else {
      logger.info(`\n======================================================`);
      logger.info(`[CONSOLE SMS OTP] To: ${formattedPhone}`);
      logger.info(`[BuddyLink] Ma OTP: ${otp} (Hieu luc: ${minutes} phut)`);
      logger.info(`======================================================\n`);
    }

    return {
      success: true,
      messageId: `console-sms-${Date.now()}`,
      mock: true,
    };
  }
}

export default new SmsAdapter();
