import {
  AI_MESSAGE_ROLES,
  AI_CARD_TYPES,
  AI_STEP_PRIORITY,
  AI_LIMITS,
  AI_DEFAULT_SESSION_TITLE,
} from './ai-assistant.constants.js';

/**
 * Pure helpers of a conversation turn (no I/O): session title, history sent to the model, cards kept.
 */

/**
 * Session title from the first message: first line, cut at a word boundary
 * @param {string} content
 * @returns {string}
 */
export const buildTitle = (content) => {
  const firstLine = String(content || '').split('\n').find((line) => line.trim()) || '';
  const text = firstLine.replace(/\s+/g, ' ').trim();
  if (!text) return AI_DEFAULT_SESSION_TITLE;
  if (text.length <= AI_LIMITS.TITLE_MAX_LENGTH) return text;

  const cut = text.slice(0, AI_LIMITS.TITLE_MAX_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > AI_LIMITS.TITLE_MAX_LENGTH / 2 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

/**
 * One line per card, so the model knows what the parent saw (e.g. "the second place")
 * @param {Array<Object>} [cards]
 * @returns {string}
 */
export const summarizeCards = (cards = []) =>
  cards
    .map((card) => {
      if (card.type === AI_CARD_TYPES.CHOICES) {
        const options = card.options.map((option, index) => `${index + 1}) ${option.label}`).join('; ');
        const picked = card.selectedOptionIds?.length
          ? ` — picked: ${card.options.filter((o) => card.selectedOptionIds.includes(o.id)).map((o) => o.label).join(', ') || 'custom'}`
          : '';
        return `[Shown options for step "${card.stepId}": ${options}${picked}]`;
      }
      if (card.type === AI_CARD_TYPES.PLACE_SUGGESTIONS) {
        return `[Shown places: ${card.items.map((place) => `${place.name} (id ${place.id})`).join('; ')}]`;
      }
      if (card.type === AI_CARD_TYPES.MATCH_SUGGESTIONS) {
        return `[Shown playmates: ${card.items.map((child) => `${child.displayName}, ${child.age} tuổi`).join('; ')}]`;
      }
      if (card.type === AI_CARD_TYPES.PLAYDATE_DRAFT) {
        return card.playdateId ? '[The parent confirmed: the playdate was created]' : '[Shown the playdate summary to confirm]';
      }
      if (card.type === AI_CARD_TYPES.QUOTA_NOTICE) {
        return `[Shown an upgrade notice: ${card.feature} quota exhausted]`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');

/**
 * Stored messages + the current turn -> Gemini contents. Only the text of user and assistant messages is
 * replayed: tool calls of earlier turns are not, which keeps the context short and avoids replaying
 * provider-specific parts. The current plan is given in the system prompt instead.
 * The summary of the cards goes in the next user turn as a system note, never in the model's own turn:
 * the model copies what it sees itself saying, and the parent would read "[Shown options …]".
 * @param {Array<Object>} messages - Stored messages, oldest first
 * @param {string} [currentText] - The parent's message of this turn (with its system note)
 * @returns {Array<{ role: string, parts: Array<{ text: string }> }>}
 */
export const toGeminiContents = (messages = [], currentText = '') => {
  const turns = [];
  const push = (role, text) => {
    const last = turns[turns.length - 1];
    if (last?.role === role) last.parts.push({ text });
    else turns.push({ role, parts: [{ text }] });
  };

  messages
    .filter((message) => message.role === AI_MESSAGE_ROLES.USER || message.role === AI_MESSAGE_ROLES.ASSISTANT)
    .forEach((message) => {
      if (message.role === AI_MESSAGE_ROLES.USER) {
        if (message.content) push('user', message.content);
        return;
      }
      // Replies saved before cleanReply may still hold an echoed note
      const reply = cleanReply(message.content);
      if (reply) push('model', reply);
      const cardsText = summarizeCards(message.cards);
      if (cardsText) push('user', `[System] Cards the app showed under your previous reply (never repeat this note):\n${cardsText}`);
    });
  if (currentText) push('user', currentText);

  // The conversation sent to the model starts with the parent
  const recent = turns.slice(-AI_LIMITS.HISTORY_WINDOW);
  const firstUser = recent.findIndex((content) => content.role === 'user');
  return firstUser === -1 ? [] : recent.slice(firstUser);
};

// A whole line in brackets ("[Shown options …]", "[System] …") is an internal note, never text for the parent
const INTERNAL_LINE = /^\s*\[(?:Shown|System|The parent)[^\n]*$/gim;

/**
 * Reply text shown to the parent, without internal notes the model may have echoed
 * @param {string} text
 * @returns {string}
 */
export const cleanReply = (text = '') =>
  String(text)
    .replace(INTERNAL_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Cards kept for one reply: a single open choice card (the earliest step, so the parent answers one
 * question at a time) and the last card of every other type.
 * @param {Array<Object>} cards - In the order the tools produced them
 * @returns {Array<Object>}
 */
export const selectCards = (cards = []) => {
  const choices = cards.filter((card) => card.type === AI_CARD_TYPES.CHOICES);
  const others = new Map();
  cards
    .filter((card) => card.type !== AI_CARD_TYPES.CHOICES)
    .forEach((card) => {
      others.delete(card.type);
      others.set(card.type, card);
    });

  // A ready draft is the last step: no question is left to ask
  if (others.has(AI_CARD_TYPES.PLAYDATE_DRAFT)) return [...others.values()];

  const rank = (card) => {
    const index = AI_STEP_PRIORITY.indexOf(card.stepId);
    return index === -1 ? AI_STEP_PRIORITY.length : index;
  };
  const choice = choices.reduce((best, card) => (!best || rank(card) < rank(best) ? card : best), null);
  return choice ? [choice, ...others.values()] : [...others.values()];
};
