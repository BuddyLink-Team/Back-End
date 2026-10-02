import mongoose from "mongoose";

const aiMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system", "tool"],
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    toolCalls: [
      {
        id: String,
        type: { type: String, default: "function" },
        function: {
          name: String,
          arguments: String,
        },
      },
    ],
    toolCallId: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const aiChatSessionSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Parent",
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "Cuộc trò chuyện mới",
      trim: true,
    },
    messages: [aiMessageSchema],
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: "ai_chat_sessions",
  },
);

aiChatSessionSchema.index({ parentId: 1, updatedAt: -1 });

const AIChatSession =
  mongoose.models.AIChatSession ||
  mongoose.model("AIChatSession", aiChatSessionSchema);

export default AIChatSession;
