import crypto from 'crypto';
import PayOS from '@payos/node';
import env from '../../config/env.js';
import logger from '../../shared/logger/index.js';
import AppError from '../../shared/exceptions/AppError.js';

let payosInstance = null;

/**
 * Sandbox without PayOS keys: the test suite, or development with PAYMENT_MODE=mock.
 * Never available in production, so payments there always go through (and are signed by) PayOS.
 */
const isSandboxAllowed = () =>
  env.NODE_ENV !== 'production' && (env.NODE_ENV === 'test' || env.PAYMENT_MODE === 'mock');

const isConfigured = Boolean(
  env.PAYOS?.CLIENT_ID &&
  !env.PAYOS.CLIENT_ID.startsWith('<') &&
  env.PAYOS?.API_KEY &&
  !env.PAYOS.API_KEY.startsWith('<') &&
  env.PAYOS?.CHECKSUM_KEY &&
  !env.PAYOS.CHECKSUM_KEY.startsWith('<')
);

if (isConfigured) {
  try {
    payosInstance = new PayOS(
      env.PAYOS.CLIENT_ID,
      env.PAYOS.API_KEY,
      env.PAYOS.CHECKSUM_KEY
    );
    logger.info('PayOS SDK adapter initialized successfully.');
  } catch (error) {
    logger.error(`Failed to initialize PayOS instance: ${error.message}`);
  }
} else {
  if (env.NODE_ENV === 'production') {
    logger.error('CRITICAL: PayOS credentials are missing in production environment!');
  } else {
    logger.warn('PayOS keys not fully configured. Development sandbox mode will be available.');
  }
}

class PayOSAdapter {
  /**
   * Check if live PayOS SDK is configured and available
   */
  isLive() {
    return Boolean(payosInstance);
  }

  /**
   * Create payment link with PayOS
   * @param {Object} paymentData
   * @param {number} paymentData.orderCode
   * @param {number} paymentData.amount
   * @param {string} paymentData.description
   * @param {string} paymentData.returnUrl
   * @param {string} paymentData.cancelUrl
   * @param {number} [paymentData.expiredAt] Unix timestamp in seconds
   * @param {Array} [paymentData.items]
   */
  async createPaymentLink(paymentData) {
    if (this.isLive()) {
      try {
        const payload = {
          orderCode: Number(paymentData.orderCode),
          amount: Number(paymentData.amount),
          description: paymentData.description.slice(0, 25),
          returnUrl: paymentData.returnUrl,
          cancelUrl: paymentData.cancelUrl,
        };

        if (paymentData.expiredAt) {
          payload.expiredAt = Number(paymentData.expiredAt);
        }

        if (Array.isArray(paymentData.items)) {
          payload.items = paymentData.items;
        }

        return await payosInstance.createPaymentLink(payload);
      } catch (error) {
        logger.error(`PayOS createPaymentLink error: ${error.message}`);
        throw new AppError(
          error.message || 'Could not create the PayOS payment link',
          502,
          'PAYMENT_GATEWAY_ERROR'
        );
      }
    }

    if (!isSandboxAllowed()) {
      throw new AppError(
        'PayOS is not configured: set the PayOS keys, or PAYMENT_MODE=mock in development',
        503,
        'PAYMENT_SERVICE_UNAVAILABLE'
      );
    }

    // Development sandbox mode (only when explicitly enabled)
    logger.info(`[Dev Mock] Generating PayOS payment link for orderCode: ${paymentData.orderCode}`);
    const mockCheckoutUrl = `${env.CLIENT_URL}/checkout?orderCode=${paymentData.orderCode}&mock=true`;
    return {
      amount: paymentData.amount,
      description: paymentData.description,
      orderCode: paymentData.orderCode,
      paymentLinkId: `mock_pl_${paymentData.orderCode}`,
      status: 'PENDING',
      checkoutUrl: paymentData.returnUrl || mockCheckoutUrl,
      qrCode: `00020101021238580010A00000072701280006970407011010287239480208QRIBFTTA5303704540${paymentData.amount}5802VN62${paymentData.description.length}${paymentData.description}6304MOCK`,
    };
  }

  /**
   * Query payment information from PayOS by orderCode
   * @param {number|string} orderCode
   */
  async getPaymentLinkInformation(orderCode) {
    if (this.isLive()) {
      try {
        return await payosInstance.getPaymentLinkInformation(Number(orderCode));
      } catch (error) {
        const isNotFound =
          error.message?.includes('không tồn tại') ||
          error.message?.includes('not found') ||
          error.code === '201';
        if (isNotFound) {
          logger.warn(`PayOS order ${orderCode} not found: ${error.message}`);
        } else {
          logger.error(`PayOS getPaymentLinkInformation error for order ${orderCode}: ${error.message}`);
        }
        throw new AppError(
          error.message || 'Could not read the payment from PayOS',
          isNotFound ? 404 : 502,
          isNotFound ? 'PAYMENT_LINK_NOT_FOUND' : 'PAYMENT_GATEWAY_ERROR'
        );
      }
    }

    if (!isSandboxAllowed()) {
      throw new AppError(
        'PayOS is not configured on the server',
        503,
        'PAYMENT_SERVICE_UNAVAILABLE'
      );
    }

    // Development sandbox fallback
    return {
      orderCode: Number(orderCode),
      status: 'PENDING',
      isMock: true,
    };
  }

  /**
   * Cancel payment link with PayOS
   * @param {number|string} orderCode
   * @param {string} [cancellationReason]
   */
  async cancelPaymentLink(orderCode, cancellationReason) {
    if (this.isLive()) {
      try {
        return await payosInstance.cancelPaymentLink(Number(orderCode), cancellationReason);
      } catch (error) {
        logger.error(`PayOS cancelPaymentLink error for order ${orderCode}: ${error.message}`);
        throw new AppError(
          error.message || 'Could not cancel the PayOS payment link',
          502,
          'PAYMENT_GATEWAY_ERROR'
        );
      }
    }

    throw new AppError(
      'PayOS is not configured on the server',
      503,
      'PAYMENT_SERVICE_UNAVAILABLE'
    );
  }

  /**
   * Validate and register Webhook URL with PayOS
   * @param {string} webhookUrl
   */
  async confirmWebhook(webhookUrl) {
    if (this.isLive()) {
      try {
        return await payosInstance.confirmWebhook(webhookUrl);
      } catch (error) {
        logger.error(`PayOS confirmWebhook error: ${error.message}`);
        throw new AppError(
          error.message || 'Could not confirm the webhook URL with PayOS',
          502,
          'PAYMENT_GATEWAY_ERROR'
        );
      }
    }

    throw new AppError(
      'PayOS is not configured on the server',
      503,
      'PAYMENT_SERVICE_UNAVAILABLE'
    );
  }

  /**
   * Verify webhook signature and parse webhook body
   * Strictly validates HMAC SHA-256 signature using PayOS SDK or fallback validator in test/mock mode
   * @param {Object} webhookBody
   */
  verifyPaymentWebhookData(webhookBody) {
    if (this.isLive()) {
      if (!webhookBody?.signature) {
        throw new AppError(
          'Webhook payload has no signature',
          400,
          'INVALID_WEBHOOK_SIGNATURE'
        );
      }

      try {
        return payosInstance.verifyPaymentWebhookData(webhookBody);
      } catch (error) {
        logger.warn(`PayOS webhook signature verification failed: ${error.message}`);
        throw new AppError(
          'Invalid PayOS webhook signature',
          400,
          'INVALID_WEBHOOK_SIGNATURE'
        );
      }
    }

    if (isSandboxAllowed() && env.PAYOS?.CHECKSUM_KEY) {
      if (!webhookBody?.signature) {
        throw new AppError(
          'Webhook payload has no signature',
          400,
          'INVALID_WEBHOOK_SIGNATURE'
        );
      }

      try {
        const data = webhookBody.data || {};
        const sorted = Object.keys(data)
          .sort()
          .reduce((obj, key) => {
            obj[key] = data[key];
            return obj;
          }, {});

        const queryStr = Object.keys(sorted)
          .filter((key) => sorted[key] !== undefined)
          .map((key) => {
            let value = sorted[key];
            if (value && Array.isArray(value)) {
              value = JSON.stringify(
                value.map((val) =>
                  Object.keys(val)
                    .sort()
                    .reduce((o, k) => {
                      o[k] = val[k];
                      return o;
                    }, {})
                )
              );
            }
            if ([null, undefined, 'undefined', 'null'].includes(value)) {
              value = '';
            }
            return `${key}=${value}`;
          })
          .join('&');

        const calculatedSignature = crypto
          .createHmac('sha256', env.PAYOS.CHECKSUM_KEY)
          .update(queryStr)
          .digest('hex');

        if (calculatedSignature !== webhookBody.signature) {
          throw new Error('Signature mismatch');
        }

        return data;
      } catch (error) {
        logger.warn(`PayOS webhook signature verification failed: ${error.message}`);
        throw new AppError(
          'Invalid PayOS webhook signature',
          400,
          'INVALID_WEBHOOK_SIGNATURE'
        );
      }
    }

    throw new AppError(
      'PayOS webhook checksum key is not configured',
      503,
      'PAYMENT_SERVICE_UNAVAILABLE'
    );
  }
}

export default new PayOSAdapter();
