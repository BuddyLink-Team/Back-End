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
    // Role 'tool': name of the function that produced this result
    toolName: String,
    // Role 'assistant': Tool UI Cards rendered by the FE (choices, places, matches, playdate draft)
    cards: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },
    // Role 'assistant': tools called while producing this reply
    toolsUsed: {
      type: [String],
      default: undefined,
    },
    // Role 'user': the message was sent by tapping options of a choice card
    choice: {
      type: new mongoose.Schema(
        {
          messageId: mongoose.Schema.Types.ObjectId,
          stepId: String,
          optionIds: [String],
        },
        { _id: false },
      ),
      default: undefined,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
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
    // Playdate being planned step by step (plan-draft.rules.js), null when no plan is in progress
    planDraft: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // User messages sent in this session (capped per plan)
    messageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // When this session used its monthly AI assistant quota unit (first successful reply)
    quotaConsumedAt: {
      type: Date,
      default: null,
    },
    // Set while a reply is being generated, so one session handles one message at a time
    pendingSince: {
      type: Date,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    tokenUsage: {
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      totalTokens: { type: Number, default: 0 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "ai_chat_sessions",
  },
);

aiChatSessionSchema.index({ parentId: 1, isActive: 1, updatedAt: -1 });

const AIChatSession =
  mongoose.models.AIChatSession ||
  mongoose.model("AIChatSession", aiChatSessionSchema);

export default AIChatSession;
