import nodemailer from "nodemailer";
import env from "../../config/env.js";
import logger from "../../shared/logger/index.js";

/**
 * Escape user-provided text before inserting it into email HTML (e.g. a full name containing
 * markup or links would otherwise be rendered inside our branded email)
 */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const SMTP_TIMEOUT_MS = 10000;

class MailAdapter {
  constructor() {
    this.transporter = null;
    this.initTransporter();
  }

  initTransporter() {
    if (env.EMAIL.SMTP_HOST && env.EMAIL.SMTP_USER && env.EMAIL.SMTP_PASSWORD) {
      this.transporter = nodemailer.createTransport({
        host: env.EMAIL.SMTP_HOST,
        port: env.EMAIL.SMTP_PORT,
        secure: env.EMAIL.SMTP_PORT === 465,
        auth: {
          user: env.EMAIL.SMTP_USER,
          pass: env.EMAIL.SMTP_PASSWORD,
        },
        // Fail fast instead of nodemailer's 2-minute default (e.g. when the host blocks SMTP ports)
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS,
      });
    } else {
      logger.warn(
        "SMTP configuration missing. Email will run in mock mode (logged to console).",
      );
    }
  }

  /**
   * Check the SMTP connection and credentials (called once at startup so deploy logs show
   * a misconfiguration right away).
   */
  async verifyConnection() {
    if (!this.transporter || process.env.NODE_ENV === "test") return;
    try {
      await this.transporter.verify();
      logger.info(`SMTP connection ready (${env.EMAIL.SMTP_HOST}:${env.EMAIL.SMTP_PORT})`);
    } catch (error) {
      logger.error(
        `SMTP connection failed (${env.EMAIL.SMTP_HOST}:${env.EMAIL.SMTP_PORT}): [${error.code || "UNKNOWN"}] ${error.message}`,
      );
    }
  }

  async sendEmailOtp({ to, otp, fullName = "Quý phụ huynh", minutes = 5 }) {
    const subject = "BuddyLink - Mã xác thực tài khoản Email của bạn";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #4F46E5; text-align: center; margin-bottom: 24px;">Xác thực tài khoản BuddyLink</h2>
        <p style="font-size: 15px; color: #374151;">Xin chào <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="font-size: 15px; color: #374151; line-height: 1.6;">
          Cảm ơn bạn đã tham gia nền tảng <strong>BuddyLink</strong>! Vui lòng sử dụng mã OTP dưới đây để xác thực địa chỉ email của bạn:
        </p>
        <div style="background-color: #F3F4F6; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1F2937;">${otp}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px; line-height: 1.5;">
          Mã xác thực này có hiệu lực trong vòng <strong>${minutes} phút</strong>. Vì lý do bảo mật, vui lòng không chia sẻ mã này cho bất kỳ ai. Nếu bạn không thực hiện yêu cầu này, xin hãy bỏ qua email.
        </p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="text-align: center; color: #9CA3AF; font-size: 12px;">© BuddyLink Platform. Kết nối bạn chơi và đồng hành cùng bé.</p>
      </div>
    `;

    return this._send({
      to,
      subject,
      html,
      text: `Mã xác thực BuddyLink của bạn là: ${otp} (Hiệu lực ${minutes} phút).`,
    });
  }

  async sendPasswordResetEmail({
    to,
    token,
    fullName = "Quý phụ huynh",
    minutes = 15,
  }) {
    const subject = "BuddyLink - Yêu cầu đặt lại mật khẩu của bạn";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="color: #EF4444; text-align: center; margin-bottom: 24px;">Đặt lại mật khẩu BuddyLink</h2>
        <p style="font-size: 15px; color: #374151;">Xin chào <strong>${escapeHtml(fullName)}</strong>,</p>
        <p style="font-size: 15px; color: #374151; line-height: 1.6;">
          Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Vui lòng nhập mã xác thực bên dưới để thiết lập mật khẩu mới:
        </p>
        <div style="background-color: #FEE2E2; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0;">
          <span style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #991B1B;">${token}</span>
        </div>
        <p style="color: #6B7280; font-size: 14px; line-height: 1.5;">
          Mã này có hiệu lực trong vòng <strong>${minutes} phút</strong>. Nếu bạn không gửi yêu cầu đặt lại mật khẩu, xin hãy kiểm tra và bảo mật lại tài khoản ngay lập tức.
        </p>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="text-align: center; color: #9CA3AF; font-size: 12px;">© BuddyLink Platform. Tất cả các quyền được bảo lưu.</p>
      </div>
    `;

    return this._send({
      to,
      subject,
      html,
      text: `Mã đặt lại mật khẩu BuddyLink của bạn là: ${token} (Hiệu lực ${minutes} phút).`,
    });
  }

  async _send({ to, subject, html, text }) {
    // In test environment, bypass network SMTP to run tests fast and prevent network timeouts
    if (process.env.NODE_ENV === "test") {
      logger.info(`[TEST MOCK EMAIL] To: ${to} | Subject: ${subject}`);
      return {
        success: true,
        messageId: `test-mail-${Date.now()}`,
        mock: true,
      };
    }

    if (this.transporter) {
      try {
        const info = await this.transporter.sendMail({
          from: `"BuddyLink Team" <${env.EMAIL.FROM}>`,
          to,
          subject,
          html,
          text,
        });
        logger.info(`Email sent to ${to}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
      } catch (error) {
        logger.error(`Error sending email to ${to}: [${error.code || "UNKNOWN"}] ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    // In dev / test or when SMTP is unconfigured
    logger.info(`[MOCK EMAIL] To: ${to} | Subject: ${subject} | Body: ${text}`);
    return { success: true, mock: true };
  }
}

export default new MailAdapter();
