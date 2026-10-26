import { AI_MESSAGE_ROLES } from './ai-assistant.constants.js';
import { toDraftResponse } from './plan-draft.rules.js';

const toId = (value) => value?.toString() ?? null;

/**
 * Only what the parent sees: their messages and the assistant's text replies.
 * Tool calls and tool results stay internal.
 */
const isVisible = (message) =>
  message.role === AI_MESSAGE_ROLES.USER || (message.role === AI_MESSAGE_ROLES.ASSISTANT && Boolean(message.content));

export class AIMessageDTO {
  static toResponse(message) {
    return {
      id: toId(message._id),
      role: message.role,
      content: message.content || '',
      cards: message.cards || [],
      toolsUsed: message.toolsUsed || [],
      choice: message.choice
        ? { messageId: toId(message.choice.messageId), stepId: message.choice.stepId, optionIds: message.choice.optionIds || [] }
        : null,
      createdAt: message.timestamp,
    };
  }

  static toResponseList(messages = []) {
    return messages.filter(isVisible).map(AIMessageDTO.toResponse);
  }
}

export class AISessionDTO {
  static toListItem(session) {
    return {
      id: toId(session._id),
      title: session.title,
      lastMessageAt: session.lastMessageAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  static toSummary(session, messageCap) {
    return {
      ...AISessionDTO.toListItem(session),
      messageCount: session.messageCount || 0,
      messageCap,
    };
  }

  static toDetail(session, messageCap) {
    return {
      ...AISessionDTO.toSummary(session, messageCap),
      planDraft: toDraftResponse(session.planDraft),
      messages: AIMessageDTO.toResponseList(session.messages),
    };
  }
}
