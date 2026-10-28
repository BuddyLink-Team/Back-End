export const AI_MESSAGE_ROLES = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  TOOL: 'tool',
});

export const AI_TOOL_NAMES = Object.freeze({
  GET_MY_CHILDREN: 'getMyChildren',
  FIND_MATCHES: 'findMatches',
  FIND_NEARBY_PLACES: 'findNearbyPlaces',
  SUGGEST_TIME_SLOTS: 'suggestTimeSlots',
  FIND_AVAILABLE_PLAYMATES: 'findAvailablePlaymates',
  SUGGEST_ACTIVITIES: 'suggestActivities',
  SUGGEST_PLACES: 'suggestPlaces',
  PROPOSE_PLAYDATE: 'proposePlaydate',
  SEND_CONNECTION_REQUESTS: 'sendConnectionRequests',
});

// Tool UI Cards returned with an assistant reply
export const AI_CARD_TYPES = Object.freeze({
  CHOICES: 'choices', // one step the parent answers by tapping
  PLACE_SUGGESTIONS: 'place_suggestions',
  MATCH_SUGGESTIONS: 'match_suggestions',
  PLAYDATE_DRAFT: 'playdate_draft', // confirm step of a plan
  QUOTA_NOTICE: 'quota_notice', // another quota (e.g. playdate creation) blocks what the parent asked
});

export const AI_CHOICE_STATUS = Object.freeze({
  OPEN: 'open',
  ANSWERED: 'answered',
});

// Steps of a choice card. Planning steps run in this order; earlier steps win when a reply has several.
export const AI_STEPS = Object.freeze({
  MATCH_CRITERIA: 'match_criteria',
  CONNECT: 'connect', // send connection requests to children of a match list
  CHILD: 'child',
  TIME: 'time',
  PLAYMATES: 'playmates',
  ACTIVITY: 'activity',
  PLACE: 'place',
  AGENDA: 'agenda', // main activities, edited by the parent before the summary
  EXTRA: 'extra', // last question: anything else to add?
});
export const AI_PLAN_STEP_ORDER = Object.freeze([
  AI_STEPS.CHILD,
  AI_STEPS.TIME,
  AI_STEPS.PLAYMATES,
  AI_STEPS.ACTIVITY,
  AI_STEPS.PLACE,
  AI_STEPS.AGENDA,
  AI_STEPS.EXTRA,
]);
export const AI_STEP_PRIORITY = Object.freeze([AI_STEPS.MATCH_CRITERIA, AI_STEPS.CONNECT, ...AI_PLAN_STEP_ORDER]);
// The summary card: its button creates the playdate
export const AI_CONFIRM_STEP = 'confirm';

export const AI_PLAN_STATUS = Object.freeze({
  COLLECTING: 'collecting',
  READY: 'ready',
});

// Option ids with a fixed meaning
export const AI_OPTION_IDS = Object.freeze({
  SKIP: '__skip',
  CRITERIA_CONFIRM: 'criteria:confirm',
  AGENDA_CONFIRM: 'agenda:confirm',
  EXTRA_NONE: 'extra:none',
  CREATE_PLAYDATE: 'confirm:create',
});

export const AI_DRAFT_WARNING_CODES = Object.freeze({
  AGE_GAP: 'AGE_GAP',
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  PAST_DATE: 'PAST_DATE',
  INVITEE_NOT_FRIEND: 'INVITEE_NOT_FRIEND',
  UNUSUAL_HOUR: 'UNUSUAL_HOUR',
  FAR_PLACE: 'FAR_PLACE', // the place is far from a family's home
});

// A playdate starting earlier or ending later than this gets an UNUSUAL_HOUR warning
export const AI_PLAYDATE_HOURS = Object.freeze({
  EARLIEST_START: '07:00',
  LATEST_END: '21:00',
});

// Parts of the web app the assistant may point to, written [[name]] and shown as links
// (FE: AI_APP_SECTIONS, same names as the navigation bar and the account menu)
export const AI_APP_SECTIONS = Object.freeze({
  'Hẹn chơi': 'playdates: upcoming and past playdates, invitations, ratings',
  'Khám phá': 'discovery: find new playmates by swiping profiles',
  'Kết nối': 'connections: friend families and connection requests',
  'Tin nhắn': 'chat with friend families and playdate groups',
  'Thành tích': 'badges, streaks and points',
  'Hồ sơ cá nhân': "the parent's profile: location, preferred days and places",
  'Quản lý hồ sơ bé': "the children's profiles: add or edit a child, interests",
  'Gói hội viên & Hạn mức': 'Free / Premium plan and the monthly quotas',
});

export const AI_LIMITS = Object.freeze({
  MAX_TOOL_ROUNDS: 3, // per user message
  MAX_MESSAGE_LENGTH: 2000,
  HISTORY_WINDOW: 20, // stored text messages sent back to the model
  TITLE_MAX_LENGTH: 60,
  MAX_OPTIONS: 5,
  MAX_PLAYMATE_OPTIONS: 8,
  MAX_SEARCHED_INVITEES: 20, // friends' children picked in the search of the playmates card
  MAX_MATCHES: 5,
  MAX_PLACES: 8,
  MAX_PLACE_TYPES: 3, // activity place types searched for the place step
  MAX_AGENDA_ITEMS: 5,
  FAR_PLACE_KM: 15, // FAR_PLACE above this distance from a family
  AGENDA_ITEM_MAX_LENGTH: 80,
  NOTE_MAX_LENGTH: 500,
  TOOL_RESULT_MAX_LENGTH: 6000, // stored tool message content
  SESSIONS_PAGE_SIZE: 20,
  SESSIONS_MAX_PAGE_SIZE: 50,
  // Model calls of one turn stop at this deadline (below the FE request timeout of 90 s)
  TURN_TIMEOUT_MS: 70 * 1000,
  // Tool rounds stop when less than this is left, so the last call still has time to answer
  FINAL_REPLY_RESERVE_MS: 15 * 1000,
  PENDING_LOCK_MS: 2 * 60 * 1000, // a lock older than this is considered stale (longer than a turn)
  OPTION_ID_MAX_LENGTH: 120,
  MAX_SEARCH_RADIUS_KM: 10,
});

// User messages allowed in one session (the session costs one monthly quota unit)
export const AI_SESSION_MESSAGE_CAP = Object.freeze({
  FREE: 30,
  PREMIUM: 100,
});

// Per user, on POST /sessions/:id/messages
export const AI_MESSAGE_RATE_LIMIT = Object.freeze({
  WINDOW_MS: 60 * 1000,
  MAX_REQUESTS: 10,
});

export const AI_DEFAULT_SESSION_TITLE = 'Cuộc trò chuyện mới';
export const AI_AGENDA_NOTE_HEADER = 'Hoạt động chính (gợi ý bởi BuddyLink AI):';
// Header of the parent's extra request in the note, under the agenda
export const AI_EXTRA_NOTE_HEADER = 'Lưu ý thêm:';
// Reply text when the model produced cards but no sentence
export const AI_FALLBACK_REPLY = 'Mình đã chuẩn bị các lựa chọn bên dưới, bạn xem nhé.';
// Reply text when a tapped option was applied but the model could not answer
export const AI_CHOICE_FALLBACK_REPLY = 'Mình đã ghi nhận lựa chọn của bạn. Bạn xem tiếp bên dưới nhé.';

// Keys removed from every tool result before it reaches the model or the client
export const AI_SENSITIVE_KEYS = Object.freeze([
  'phone',
  'phoneNumber',
  'email',
  'dateOfBirth',
  'userId',
  'password',
  'passwordHash',
]);
