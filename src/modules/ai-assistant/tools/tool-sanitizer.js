import { AI_SENSITIVE_KEYS } from '../ai-assistant.constants.js';

const SENSITIVE = new Set(AI_SENSITIVE_KEYS);
const toId = (ref) => (ref?._id || ref)?.toString() ?? null;

const roundKm = (km, step = 0.1) => (Number.isFinite(km) ? Math.round(km / step) * step : null);
const toFixedKm = (km, step) => {
  const rounded = roundKm(km, step);
  return rounded === null ? null : Number(rounded.toFixed(1));
};

/**
 * Deep copy without sensitive keys (phone, email, date of birth...). Every tool result goes through it,
 * on top of the whitelist mappers below, so a field added to a DTO later never reaches the model.
 * @param {*} value
 * @returns {*}
 */
export const stripSensitive = (value) => {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toString();
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE.has(key))
        .map(([key, item]) => [key, stripSensitive(item)])
    );
  }
  return value;
};

/**
 * Own child (ChildResponseDTO): no parent block
 */
export const toChildItem = (child) => ({
  childId: toId(child.id || child.childId || child._id),
  displayName: child.displayName,
  age: child.age ?? null,
  gender: child.gender,
  interests: child.interests || [],
  favoriteActivities: child.favoriteActivities || [],
  personality: child.personality || [],
});

/**
 * Place from placesService (nearby search). Address and coordinates are the place's own, never a family's.
 */
export const toPlaceItem = (place) => ({
  id: toId(place.id),
  placeId: place.placeId || null,
  name: place.name,
  address: place.address || '',
  placeType: place.placeType || place.type || null,
  distanceKm: place.distanceMeters != null ? toFixedKm(place.distanceMeters / 1000, 0.1) : null,
  openingHours: place.openingHours || '',
  coordinates: Array.isArray(place.coordinates) ? place.coordinates : null,
  osmUrl: place.osmUrl || null,
});

/**
 * Place from playdateSuggestionService (between the families): distances per family, labelled by name only
 */
export const toSuggestedPlaceItem = (place) => ({
  ...toPlaceItem({ ...place, placeType: place.type }),
  isPreferredType: Boolean(place.isPreferredType),
  familyDistances: (place.familyDistances || []).map((family) => ({
    label: family.label,
    distanceKm: family.distanceKm,
  })),
});

/**
 * Discovery profile -> match card item. Approximate distance only, parent shown by name and area.
 * @param {Object} profile - DiscoveryProfileDTO
 * @param {Set<string>} ownTags - Lowercased interests + favourite activities of the own child
 */
export const toMatchItem = (profile, ownTags = new Set()) => {
  const tags = [...(profile.interests || []), ...(profile.favoriteActivities || [])];
  return {
    childId: toId(profile.childId),
    displayName: profile.displayName,
    age: profile.age ?? null,
    gender: profile.gender,
    avatarUrl: profile.avatarUrl || '',
    interests: profile.interests || [],
    sharedInterests: [...new Set(tags.filter((tag) => ownTags.has(String(tag).toLowerCase())))],
    matchScore: profile.matchScore ?? null,
    distanceKm: toFixedKm(profile.distanceKm, 0.5),
    parent: {
      parentId: toId(profile.parentId),
      fullName: profile.parent?.fullName || '',
      avatarUrl: profile.parent?.avatarUrl || '',
      area: [profile.parent?.area, profile.parent?.city].filter(Boolean).join(', '),
      isVerifiedParent: Boolean(profile.parent?.isVerifiedParent),
    },
  };
};

/**
 * Friend's child from playdateService.getInvitableFriends({ childId }) -> playmate item
 * @param {Object} entry - { parent, child, matchScore, source, warnings }
 * @param {Set<string>} ownTags
 */
export const toPlaymateItem = (entry, ownTags = new Set()) => ({
  childId: toId(entry.child.id),
  displayName: entry.child.displayName,
  age: entry.child.age ?? null,
  gender: entry.child.gender,
  avatarUrl: entry.child.avatarUrl || '',
  interests: entry.child.interests || [],
  sharedInterests: (entry.child.interests || []).filter((tag) => ownTags.has(String(tag).toLowerCase())),
  matchScore: entry.matchScore ?? null,
  source: entry.source ? 'paired' : 'friend',
  warnings: entry.warnings || [],
  parent: {
    parentId: toId(entry.parent.id),
    fullName: entry.parent.fullName || '',
    avatarUrl: entry.parent.avatarUrl || '',
    area: [entry.parent.location?.area, entry.parent.location?.city].filter(Boolean).join(', '),
    isVerifiedParent: Boolean(entry.parent.isVerified),
  },
});

/**
 * Lowercased interests + favourite activities of a child, to compute shared interests
 * @param {Object} child
 * @returns {Set<string>}
 */
export const tagsOf = (child) =>
  new Set([...(child?.interests || []), ...(child?.favoriteActivities || [])].map((tag) => String(tag).toLowerCase()));
