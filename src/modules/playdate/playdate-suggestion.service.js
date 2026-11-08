import playdateService from './playdate.service.js';
import parentService from '../parent/parent.service.js';
import childService from '../child/child.service.js';
import connectionService from '../connection/connection.service.js';
import safetyService from '../safety/safety.service.js';
import placesService from '../places/places.service.js';
import AppError from '../../shared/exceptions/app-error.js';
import { calculateAgeYears } from '../../shared/helpers/age.helper.js';
import {
  getStartOfZonedDay,
  getScheduledStart,
  getZonedParts,
  intervalsOverlap,
} from '../../shared/helpers/date.helper.js';
import { distanceKmBetween } from '../discovery/matching.rules.js';
import { PLAYDATE_RULES, SUGGESTION_LIMITS, PLACE_SUGGESTION_RADIUS } from './playdate.constants.js';
import {
  suggestTimeSlots,
  evaluateSlotFit,
  suggestActivities,
  preferredPlaceTypes,
  midpointOf,
  rankPlaces,
} from './playdate-suggestion.rules.js';
import { evaluateTimeIssues } from './playdate-time.rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const toId = (ref) => (ref?._id || ref)?.toString();
const pad = (value) => String(value).padStart(2, '0');
// "HH:mm" of an instant in the business time zone
const toClock = (date) => {
  const parts = getZonedParts(date);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
};

const hasValidCoordinates = (coordinates) =>
  Array.isArray(coordinates) &&
  coordinates.length === 2 &&
  coordinates.every((v) => Number.isFinite(v)) &&
  !(coordinates[0] === 0 && coordinates[1] === 0);

/**
 * "id1,id2" or ["id1", "id2"] -> unique ids
 * @param {string|string[]} [value]
 * @returns {string[]}
 */
const parseIdList = (value) => {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(list.map((id) => id.trim()).filter(Boolean))];
};

/**
 * Planning helpers for a new playdate (time slots, places, activities). Each suggestion is for the
 * caller's child plus optional children of connected friends. Designed to be reused as AI Agent tools.
 */
class PlaydateSuggestionService {
  /**
   * Load the families involved: the caller's own child and the children of accepted, non-blocked friends
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string|string[] }} query
   * @returns {Promise<{ parents: Array<Object>, children: Array<Object> }>} caller first
   * @private
   */
  async _loadGroup(userId, { childId, participantChildIds }) {
    const parent = await parentService.getParentByUserId(userId);
    if (!parent) {
      throw new AppError('Parent profile not found', 404, 'PARENT_NOT_FOUND');
    }

    await childService.assertChildUsable(childId, parent._id);
    const ownChild = (await childService.getActiveChildrenByParentId(parent._id)).find((c) => c._id.toString() === childId);
    if (!ownChild) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    const otherIds = parseIdList(participantChildIds).filter((id) => id !== childId);
    if (!otherIds.length) {
      return { parents: [parent], children: [ownChild] };
    }

    const [otherChildren, connections, blockedIds] = await Promise.all([
      childService.getUsableChildrenByIds(otherIds),
      connectionService.getAcceptedConnections(parent._id),
      safetyService.getBlockedParentIds(parent._id),
    ]);
    if (otherChildren.length !== otherIds.length) {
      throw new AppError('Child profile not found', 404, 'CHILD_NOT_FOUND');
    }

    // Accepted friends (both parents populated on the connection), blocked ones left out
    const blockedSet = new Set(blockedIds.map(String));
    const friendsById = new Map();
    connections.forEach((connection) => {
      const friend = connection.parents.find((p) => toId(p) !== parent._id.toString());
      if (friend && !blockedSet.has(toId(friend))) friendsById.set(toId(friend), friend);
    });

    const friendParents = new Map();
    otherChildren.forEach((child) => {
      // Another child of the caller (a parent answering for several invited children)
      if (toId(child.parentId) === toId(parent)) return;
      const friend = friendsById.get(toId(child.parentId));
      if (!friend) {
        throw new AppError('Only children of connected friends can be planned for', 403, 'NOT_CONNECTED_FRIEND');
      }
      friendParents.set(toId(friend), friend);
    });

    return { parents: [parent, ...friendParents.values()], children: [ownChild, ...otherChildren] };
  }

  /**
   * GET /playdates/suggestions/time-slots
   * Up to 3 start times fitting the families' preferred days/time slots, never in the past and never
   * overlapping another playdate of one of the children. Filters out slots where the venue is closed (BUD-49 C).
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string, from?: string, to?: string, durationMinutes?: number, placeOpeningHours?: string, placeCoordinates?: number[], placeId?: string }} query
   */
  async getTimeSlotSuggestions(userId, { childId, participantChildIds, from, to, durationMinutes, placeOpeningHours, placeCoordinates, placeId } = {}) {
    const tomorrow = new Date(getStartOfZonedDay().getTime() + DAY_MS);
    const rangeFrom = from ? new Date(from) : tomorrow;
    const rangeTo = to ? new Date(to) : new Date(rangeFrom.getTime() + (SUGGESTION_LIMITS.DEFAULT_RANGE_DAYS - 1) * DAY_MS);
    if (rangeTo < rangeFrom || rangeTo - rangeFrom > SUGGESTION_LIMITS.MAX_RANGE_DAYS * DAY_MS) {
      throw new AppError(
        `The date range must be ${SUGGESTION_LIMITS.MAX_RANGE_DAYS} days or less`,
        400,
        'INVALID_DATE_RANGE'
      );
    }

    const place = await this._placeOfSlots({ placeId, placeOpeningHours, placeCoordinates });
    const { parents, children } = await this._loadGroup(userId, { childId, participantChildIds });
    const duration = durationMinutes ? parseInt(durationMinutes, 10) : PLAYDATE_RULES.DEFAULT_DURATION_MINUTES;
    const busy = await playdateService.getBusyIntervals(
      children.map((child) => child._id),
      rangeFrom,
      new Date(rangeTo.getTime() + DAY_MS)
    );

    return {
      slots: suggestTimeSlots({
        parents,
        from: rangeFrom,
        to: rangeTo,
        durationMinutes: duration,
        busy,
        ages: children.map((child) => calculateAgeYears(child.dateOfBirth)),
        place,
      }),
    };
  }

  /**
   * The chosen place of a plan for the time rules (type, opening hours): from the cache by its cache id or
   * OpenStreetMap id, or the opening hours given by the caller. null without a place.
   * @private
   */
  async _placeOfSlots({ placeId, placeOpeningHours, placeCoordinates }) {
    if (placeId) {
      const doc = await placesService.getPlaceDocById(placeId).catch(() => null);
      if (doc) {
        return {
          placeType: doc.placeType || null,
          openingHours: doc.openingHours || placeOpeningHours || '',
          coordinates: doc.coordinates?.coordinates || placeCoordinates || null,
        };
      }
    }
    return placeOpeningHours ? { placeType: null, openingHours: placeOpeningHours, coordinates: placeCoordinates || null } : null;
  }

  /**
   * Every time rule a playdate would break (Create Playdate form, before submitting): the same rules as
   * the time suggestions and the AI plan, for the host's and the invited children and the chosen place
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string, date: string, time: string, durationMinutes?: number, placeId?: string }} query
   * @returns {Promise<{ issues: Array<{ code: string, severity: string, params?: Object }> }>}
   */
  async getTimeCheck(userId, { childId, participantChildIds, date, time, durationMinutes, placeId } = {}) {
    const { children } = await this._loadGroup(userId, { childId, participantChildIds });
    const place = await this._placeOfSlots({ placeId });
    return {
      issues: evaluateTimeIssues({
        date,
        time,
        durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : PLAYDATE_RULES.DEFAULT_DURATION_MINUTES,
        ages: children.map((child) => calculateAgeYears(child.dateOfBirth)),
        place,
      }),
    };
  }

  /**
   * How well a chosen start time fits the preferred days and time slots of the host and invited families
   * (the "Hợp với x/y gia đình" count of the time suggestions, for a time typed or picked freely)
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string, date: string, time: string }} input
   * @returns {Promise<{ matchedParents: number, totalParents: number, parentsWithPreferences: number, timeSlot: string|null, dayType: string }>}
   */
  async getSlotFit(userId, { childId, participantChildIds, date, time }) {
    const { parents } = await this._loadGroup(userId, { childId, participantChildIds });
    return evaluateSlotFit({ parents, date, time });
  }

  /**
   * GET /playdates/suggestions/places
   * Places around the families' midpoint: preferred place types first, then the nearest. The response
   * never contains the midpoint nor any family's coordinates.
   * If date and time are provided, ranks places based on whether they are open (BUD-49 C).
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string, type?: string, limit?: number, date?: string, time?: string, durationMinutes?: number }} query
   */
  async getPlaceSuggestions(userId, { childId, participantChildIds, type, limit, date, time, durationMinutes } = {}) {
    const { parents, children } = await this._loadGroup(userId, { childId, participantChildIds });

    // Saved locations are ward centers (geocoded from area + city), the same points Discovery measures from
    const families = parents
      .filter((parent) => hasValidCoordinates(parent.location?.coordinates?.coordinates))
      .map((parent) => ({
        parentId: toId(parent),
        label: toId(parent) === toId(parents[0]) ? 'Nhà bạn' : parent.fullName,
        area: [parent.location?.area, parent.location?.city].filter(Boolean).join(', '),
        point: parent.location.coordinates.coordinates,
      }));
    const familyPoints = families.map((family) => family.point);
    if (!familyPoints.length) {
      throw new AppError('Set your location in your profile to get place suggestions', 400, 'LOCATION_REQUIRED');
    }

    const [lng, lat] = midpointOf(familyPoints);
    const farthestKm = Math.max(...familyPoints.map((point) => distanceKmBetween(point, [lng, lat])));
    const radius = Math.min(
      PLACE_SUGGESTION_RADIUS.MAX_METERS,
      Math.max(PLACE_SUGGESTION_RADIUS.MIN_METERS, Math.round(farthestKm * 1000) + PLACE_SUGGESTION_RADIUS.MARGIN_METERS)
    );

    const { places } = await placesService.getNearbyPlaces(userId, { lat, lng, radius, type, limit: 50 });
    const ages = children.map((child) => calculateAgeYears(child.dateOfBirth)).filter((age) => age !== null);
    const parsedLimit = Math.min(SUGGESTION_LIMITS.MAX_PLACES, Math.max(1, parseInt(limit, 10) || SUGGESTION_LIMITS.PLACES));

    let targetStart = null;
    let targetEnd = null;
    if (date && time) {
      targetStart = getScheduledStart(new Date(date), time);
      targetEnd = new Date(targetStart.getTime() + (parseInt(durationMinutes, 10) || 60) * 60 * 1000);
    }

    return {
      places: rankPlaces(places, {
        preferredTypes: preferredPlaceTypes(parents),
        youngestAge: ages.length ? Math.min(...ages) : null,
        families,
        targetStart,
        targetEnd,
        limit: parsedLimit,
      }),
    };
  }

  /**
   * GET /playdates/busy-times
   * When the children are already busy on one day (their other upcoming playdates), so the form can show
   * the conflict as soon as a time is picked instead of waiting for the 409 on submit.
   * Only the caller's own children carry the id of the playdate they are busy with; for a friend's child only
   * the time is shared.
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string, date: string, excludePlaydateId?: string }} query
   * @returns {Promise<{ date: string, busy: Array<Object> }>} busy intervals, earliest first
   */
  async getBusyTimes(userId, { childId, participantChildIds, date, excludePlaydateId } = {}) {
    const { parents, children } = await this._loadGroup(userId, { childId, participantChildIds });
    const ownChildIds = new Set(children.filter((child) => toId(child.parentId) === toId(parents[0])).map(toId));
    const dayStart = getScheduledStart(new Date(date), '00:00');
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const intervals = await playdateService.getBusyIntervals(
      children.map((child) => child._id),
      dayStart,
      dayEnd,
      excludePlaydateId || null
    );

    const namesById = new Map(children.map((child) => [toId(child), child.displayName]));
    const seen = new Set();
    const busy = intervals
      .filter((interval) => intervalsOverlap(dayStart, dayEnd, interval.start, interval.end))
      .filter((interval) => {
        const key = `${interval.childId}:${interval.playdateId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.start - b.start)
      .map((interval) => {
        const isOwnChild = ownChildIds.has(interval.childId);
        return {
          childId: interval.childId,
          childName: namesById.get(interval.childId) || '',
          isOwnChild,
          start: toClock(interval.start),
          end: toClock(interval.end),
          startsAt: interval.start.toISOString(),
          endsAt: interval.end.toISOString(),
          ...(isOwnChild ? { playdateId: interval.playdateId } : {}),
        };
      });

    return { date, busy };
  }

  /**
   * GET /playdates/suggestions/activities
   * Activities the children share an interest in, suitable for every child's age.
   * @param {string} userId
   * @param {{ childId: string, participantChildIds?: string }} query
   */
  async getActivitySuggestions(userId, { childId, participantChildIds } = {}) {
    const { children } = await this._loadGroup(userId, { childId, participantChildIds });
    return { activities: suggestActivities(children) };
  }
}

export const playdateSuggestionService = new PlaydateSuggestionService();
export default playdateSuggestionService;
