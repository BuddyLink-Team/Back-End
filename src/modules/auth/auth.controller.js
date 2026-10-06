import authService from './auth.service.js';
import {
  clearAuthCookies,
  getRefreshTokenFromRequest,
} from '../../shared/helpers/token.helper.js';
import { successResponse } from '../../shared/response/index.js';

class AuthController {
  async register(req, res, next) {
    try {
      const { fullName, email, password, phone } = req.body;
      const { dto } = await authService.register({ fullName, email, password, phone });

      return successResponse(res, dto, 'User registered successfully', 201);
    } catch (error) {
      return next(error);
    }
  }

  async googleAuth(req, res, next) {
    try {
      const { idToken } = req.body;
      const { dto } = await authService.loginWithGoogle({ idToken });

      return successResponse(res, dto, 'Google authentication successful', 200);
    } catch (error) {
      return next(error);
    }
  }

  async login(req, res, next) {
    try {
      const { email, password } = req.body;
      const { dto } = await authService.login({ email, password });

      return successResponse(res, dto, 'Login successful', 200);
    } catch (error) {
      return next(error);
    }
  }

  async loginAdmin(req, res, next) {
    try {
      const { email, password } = req.body;
      const { dto } = await authService.loginAdmin({ email, password });

      return successResponse(res, dto, 'Admin login successful', 200);
    } catch (error) {
      return next(error);
    }
  }

  async sendPhoneOtp(req, res, next) {
    try {
      const { phone } = req.body;
      const result = await authService.sendPhoneOtp(req.userId, phone);
      return successResponse(res, null, result.message, 200);
    } catch (error) {
      return next(error);
    }
  }

  async verifyPhoneOtp(req, res, next) {
    try {
      const { phone, otp } = req.body;
      const dto = await authService.verifyPhoneOtp(req.userId, phone, otp);
      return successResponse(res, dto, 'Phone verified successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async verifyFirebasePhone(req, res, next) {
    try {
      const { idToken } = req.body;
      const result = await authService.verifyFirebasePhone(req.userId, idToken);
      return successResponse(res, result, 'Phone verified successfully via Firebase', 200);
    } catch (error) {
      return next(error);
    }
  }

  async sendEmailOtp(req, res, next) {
    try {
      const result = await authService.sendEmailOtp(req.userId);
      return successResponse(res, null, result.message, 200);
    } catch (error) {
      return next(error);
    }
  }

  async verifyEmailOtp(req, res, next) {
    try {
      const { otp } = req.body;
      const dto = await authService.verifyEmailOtp(req.userId, otp);
      return successResponse(res, dto, 'Email verified successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      const result = await authService.forgotPassword(email);
      return successResponse(res, null, result.message, 200);
    } catch (error) {
      return next(error);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const { email, token, newPassword } = req.body;
      const result = await authService.resetPassword({ email, token, newPassword });
      return successResponse(res, null, result.message, 200);
    } catch (error) {
      return next(error);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const token = getRefreshTokenFromRequest(req);
      const { dto } = await authService.refreshToken(token);

      return successResponse(res, dto, 'Tokens refreshed successfully', 200);
    } catch (error) {
      return next(error);
    }
  }

  async logout(req, res, next) {
    try {
      const token = getRefreshTokenFromRequest(req);
      const result = await authService.logout(token);

      clearAuthCookies(res);
      return successResponse(res, null, result.message, 200);
    } catch (error) {
      return next(error);
    }
  }

  async getMe(req, res, next) {
    try {
      const dto = await authService.getMe(req.userId);
      return successResponse(res, dto, 'Current user profile retrieved', 200);
    } catch (error) {
      return next(error);
    }
  }
}

export default new AuthController();
