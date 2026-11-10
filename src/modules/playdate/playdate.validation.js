import { body, param, query } from 'express-validator';
import { PLAYDATE_RULES, SUGGESTION_LIMITS, CHAPERONE_ACTIONS, LEAVE_RULES } from './playdate.constants.js';
import { PLACE_TYPES } from '../places/places.constants.js';

// A playdate starts at a 24-hour time 'HH:mm' and lasts durationMinutes
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const durationRule = (field) =>
  body(field)
    .optional()
    .isInt({ min: PLAYDATE_RULES.MIN_DURATION_MINUTES, max: PLAYDATE_RULES.MAX_DURATION_MINUTES })
    .withMessage(
      `Duration must be between ${PLAYDATE_RULES.MIN_DURATION_MINUTES} and ${PLAYDATE_RULES.MAX_DURATION_MINUTES} minutes`
    )
    .toInt();

/**
 * Validation rules for GET /playdates
 */
export const getPlaydatesValidation = [
  query('status')
    .optional()
    .trim()
    .isIn(['all', 'upcoming', 'pending', 'confirmed', 'completed', 'cancelled'])
    .withMessage('Invalid filter status (all, upcoming, pending, confirmed, completed, cancelled)'),
  query('search')
    .optional()
    .trim()
    .isString()
    .withMessage('Search term must be a string'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO8601 date'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

/**
 * Validation rules for Playdate ID param
 */
export const playdateIdParamValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
];

/**
 * Validation rules for POST /playdates/:id/leave (the reason is optional and sent to the host)
 */
export const leavePlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('reason')
    .optional({ nullable: true })
    .isString()
    .withMessage('Leave reason must be a string')
    .trim()
    .isLength({ max: LEAVE_RULES.REASON_MAX_LENGTH })
    .withMessage(`Leave reason must be at most ${LEAVE_RULES.REASON_MAX_LENGTH} characters`),
];

/**
 * Validation rules for POST /playdates/:id/chaperone
 */
export const chaperoneValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('action')
    .optional()
    .isIn(Object.values(CHAPERONE_ACTIONS))
    .withMessage(`action must be one of: ${Object.values(CHAPERONE_ACTIONS).join(', ')}`),
];

/**
 * Validation rules for POST /playdates (Create Playdate)
 */
export const createPlaydateValidation = [
  body('hostChildId')
    .notEmpty()
    .withMessage('Please select your participating child')
    .isMongoId()
    .withMessage('Invalid child profile ID'),
  // Every own child who comes (hostChildId included); hostChildId alone when omitted
  body('hostChildIds')
    .optional()
    .isArray({ min: 1, max: PLAYDATE_RULES.MAX_HOST_CHILDREN })
    .withMessage(`hostChildIds must list 1 to ${PLAYDATE_RULES.MAX_HOST_CHILDREN} of your children`),
  body('hostChildIds.*').isMongoId().withMessage('Invalid child profile ID'),
  body('scheduledDate')
    .notEmpty()
    .withMessage('Scheduled date is required')
    .isISO8601()
    .toDate()
    .withMessage('Invalid scheduled date')
    .custom((value) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(value) < today) {
        throw new Error('Scheduled date must be in the future');
      }
      return true;
    }),
  body('time')
    .trim()
    .notEmpty()
    .withMessage('Time is required')
    .matches(TIME_REGEX)
    .withMessage('Time must be in 24-hour HH:mm format'),
  durationRule('durationMinutes'),
  body('activity')
    .trim()
    .notEmpty()
    .withMessage('Activity description is required'),
  body('location.name')
    .trim()
    .notEmpty()
    .withMessage('Location name is required'),
  body('location.address')
    .trim()
    .notEmpty()
    .withMessage('Location address is required'),
  body('location.placeId')
    .optional()
    .trim()
    .isString(),
  body('note')
    .optional()
    .trim(),
  body('participants')
    .optional()
    .isArray()
    .withMessage('Participants must be an array'),
  body('participants.*.parentId')
    .notEmpty()
    .withMessage('Participant parentId is required')
    .isMongoId()
    .withMessage('Invalid participant parentId'),
  body('participants.*.childId')
    .notEmpty()
    .withMessage('Participant childId is required')
    .isMongoId()
    .withMessage('Invalid participant childId'),
];

/**
 * Validation rules for POST /playdates/:id/participants (host invites more friends)
 */
export const inviteParticipantsValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('participants')
    .isArray({ min: 1 })
    .withMessage('Pick at least one friend to invite'),
  body('participants.*.parentId')
    .notEmpty()
    .withMessage('Participant parentId is required')
    .isMongoId()
    .withMessage('Invalid participant parentId'),
  body('participants.*.childId')
    .notEmpty()
    .withMessage('Participant childId is required')
    .isMongoId()
    .withMessage('Invalid participant childId'),
];

/**
 * Validation rules for PATCH /playdates/:id/cancel
 */
export const cancelPlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('reason')
    .optional()
    .trim()
    .isString()
    .withMessage('Cancellation reason must be a string'),
];

/**
 * Validation rules for PUT /playdates/:id/respond
 */
export const respondPlaydateValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('status')
    .notEmpty()
    .withMessage('Response status is required')
    .isIn(['accepted', 'declined'])
    .withMessage('Status must be accepted or declined'),
];

/**
 * Validation rules for POST /playdates/:id/reschedule
 */
export const createRescheduleValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('newDate')
    .notEmpty()
    .withMessage('New date is required')
    .isISO8601()
    .toDate()
    .withMessage('Invalid new date')
    .custom((value) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(value) < today) {
        throw new Error('New proposed date must be in the future');
      }
      return true;
    }),
  body('newStartTime')
    .trim()
    .notEmpty()
    .withMessage('New start time is required')
    .matches(TIME_REGEX)
    .withMessage('New start time must be in 24-hour HH:mm format'),
  durationRule('newDurationMinutes'),
  body('newLocation.name')
    .optional()
    .trim()
    .custom((value, { req }) => !value || Boolean(req.body.newLocation?.address?.trim()))
    .withMessage('A new location needs both a name and an address'),
  body('newLocation.address')
    .optional()
    .trim()
    .custom((value, { req }) => !value || Boolean(req.body.newLocation?.name?.trim()))
    .withMessage('A new location needs both a name and an address'),
  body('reason')
    .optional()
    .trim(),
];

/**
 * Validation rules for PUT /playdates/:id/reschedule/vote
 */
export const voteRescheduleValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('requestId')
    .optional()
    .isMongoId()
    .withMessage('Invalid reschedule request ID'),
  body('status')
    .notEmpty()
    .withMessage('Vote choice is required')
    .isIn(['accepted', 'declined'])
    .withMessage('Vote choice must be accepted or declined'),
];

/**
 * Validation rules for PATCH /playdates/:id/reschedule/cancel
 */
export const cancelRescheduleValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid playdate ID'),
  body('requestId')
    .optional()
    .isMongoId()
    .withMessage('Invalid reschedule request ID'),
];

/**
 * Validation rules for the invitable friends list
 */
export const getInvitableFriendsValidation = [
  query('childId').optional().isMongoId().withMessage('Invalid child profile ID'),
  query('search').optional().isString().trim().isLength({ max: 100 }).withMessage('search must be at most 100 characters'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];

// childId (own child, required) + participantChildIds (comma-separated children of friends)
const suggestionGroupRules = [
  query('childId')
    .notEmpty()
    .withMessage('childId is required')
    .isMongoId()
    .withMessage('Invalid child profile ID'),
  query('participantChildIds')
    .optional()
    .isString()
    .custom((value) => {
      const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
      return ids.length <= SUGGESTION_LIMITS.MAX_PARTICIPANT_CHILDREN && ids.every((id) => /^[a-f\d]{24}$/i.test(id));
    })
    .withMessage(`participantChildIds must be up to ${SUGGESTION_LIMITS.MAX_PARTICIPANT_CHILDREN} comma-separated child IDs`),
];

/**
 * Validation rules for GET /playdates/suggestions/time-slots
 */
export const timeSlotSuggestionsValidation = [
  ...suggestionGroupRules,
  query('from').optional().isISO8601().withMessage('from must be a valid ISO8601 date'),
  query('to').optional().isISO8601().withMessage('to must be a valid ISO8601 date'),
  // The chosen place (cache id or OpenStreetMap id): its opening hours and type apply to the times
  query('placeId').optional().isString().isLength({ max: 80 }).withMessage('Invalid place ID'),
  query('durationMinutes')
    .optional()
    .isInt({ min: PLAYDATE_RULES.MIN_DURATION_MINUTES, max: PLAYDATE_RULES.MAX_DURATION_MINUTES })
    .withMessage(
      `Duration must be between ${PLAYDATE_RULES.MIN_DURATION_MINUTES} and ${PLAYDATE_RULES.MAX_DURATION_MINUTES} minutes`
    ),
];

/**
 * Validation rules for GET /playdates/suggestions/places
 */
export const placeSuggestionsValidation = [
  ...suggestionGroupRules,
  query('type')
    .optional()
    .isIn(Object.values(PLACE_TYPES))
    .withMessage(`type must be one of ${Object.values(PLACE_TYPES).join(', ')}`),
  query('limit')
    .optional()
    .isInt({ min: 1, max: SUGGESTION_LIMITS.MAX_PLACES })
    .withMessage(`limit must be between 1 and ${SUGGESTION_LIMITS.MAX_PLACES}`),
  // The chosen time: places closed then (or closing early, dark parks) are listed last
  query('date').optional().isISO8601().withMessage('date must be a valid ISO8601 date'),
  query('time')
    .optional()
    .matches(TIME_REGEX)
    .withMessage('time must be HH:mm'),
  query('durationMinutes')
    .optional()
    .isInt({ min: PLAYDATE_RULES.MIN_DURATION_MINUTES, max: PLAYDATE_RULES.MAX_DURATION_MINUTES })
    .withMessage(
      `Duration must be between ${PLAYDATE_RULES.MIN_DURATION_MINUTES} and ${PLAYDATE_RULES.MAX_DURATION_MINUTES} minutes`
    ),
];

/**
 * Validation rules for GET /playdates/suggestions/time-check (every time rule of a chosen time)
 */
export const timeCheckValidation = [
  ...suggestionGroupRules,
  query('date').notEmpty().withMessage('date is required').isISO8601().withMessage('date must be a valid ISO8601 date'),
  query('time')
    .notEmpty()
    .withMessage('time is required')
    .matches(TIME_REGEX)
    .withMessage('time must be HH:mm'),
  query('durationMinutes')
    .optional()
    .isInt({ min: PLAYDATE_RULES.MIN_DURATION_MINUTES, max: PLAYDATE_RULES.MAX_DURATION_MINUTES })
    .withMessage(
      `Duration must be between ${PLAYDATE_RULES.MIN_DURATION_MINUTES} and ${PLAYDATE_RULES.MAX_DURATION_MINUTES} minutes`
    ),
  // The chosen place (cache id or OpenStreetMap id): its opening hours and type apply to the times
  query('placeId').optional().isString().isLength({ max: 80 }).withMessage('Invalid place ID'),
];

/**
 * Validation rules for GET /playdates/busy-times
 */
export const busyTimesValidation = [
  ...suggestionGroupRules,
  query('date')
    .notEmpty()
    .withMessage('date is required')
    .isISO8601()
    .withMessage('date must be a valid ISO8601 date'),
  query('excludePlaydateId').optional().isMongoId().withMessage('Invalid playdate ID'),
];

/**
 * Validation rules for GET /playdates/suggestions/activities
 */
export const activitySuggestionsValidation = [...suggestionGroupRules];
