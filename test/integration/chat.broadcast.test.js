import { describe, it, expect } from '@jest/globals';
import { broadcastNewMessage } from '../../src/sockets/chat.broadcast.js';
import { SOCKET_EVENTS } from '../../src/modules/chat/chat.constants.js';

// Minimal Socket.IO server stub that records every io.to(room).emit(event, payload)
const createIoStub = () => {
  const emitted = [];
  return {
    emitted,
    to: (room) => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
  };
};

describe('broadcastNewMessage', () => {
  const senderId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const recipientId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

  const result = {
    message: {
      _id: 'cccccccccccccccccccccccc',
      conversationId: 'dddddddddddddddddddddddd',
      senderId: { _id: senderId, fullName: 'Sender' },
      type: 'text',
      content: 'Hello',
      readBy: [],
    },
    conversation: {
      _id: 'dddddddddddddddddddddddd',
      type: 'direct',
      participants: [
        { _id: senderId, fullName: 'Sender' },
        { _id: recipientId, fullName: 'Recipient' },
      ],
      unreadCounts: { [recipientId]: 3 },
    },
  };

  it('should emit personalized DTOs only to each participant personal room', () => {
    const io = createIoStub();
    broadcastNewMessage(io, result);

    expect(io.emitted.every(({ room }) => room.startsWith('parent:'))).toBe(true);

    const recipientConv = io.emitted.find(
      ({ room, event }) => room === `parent:${recipientId}` && event === SOCKET_EVENTS.CONVERSATION_UPDATED
    );
    expect(recipientConv.payload.partner.id).toBe(senderId);
    expect(recipientConv.payload.unreadCount).toBe(3);

    const recipientMsg = io.emitted.find(
      ({ room, event }) => room === `parent:${recipientId}` && event === SOCKET_EVENTS.RECEIVE_MESSAGE
    );
    expect(recipientMsg.payload.isMine).toBe(false);

    const senderMsg = io.emitted.find(
      ({ room, event }) => room === `parent:${senderId}` && event === SOCKET_EVENTS.RECEIVE_MESSAGE
    );
    expect(senderMsg.payload.isMine).toBe(true);
  });
});
