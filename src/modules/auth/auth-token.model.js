import mongoose from 'mongoose';

const authTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    target: {
      type: String,
      required: true,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['phone_otp', 'password_reset', 'email_verify'],
      required: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    // Failed verification attempts; the token is invalidated after OTP_CONFIG.MAX_ATTEMPTS
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL Index: automatically deletes expired tokens
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'auth_tokens',
  }
);

authTokenSchema.index({ target: 1, type: 1 });
authTokenSchema.index({ tokenHash: 1 });

const AuthToken = mongoose.models.AuthToken || mongoose.model('AuthToken', authTokenSchema);

export default AuthToken;
