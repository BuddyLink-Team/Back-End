import placesService from '../../places/places.service.js';
import { PLACE_TYPES } from '../../places/places.constants.js';
import { AI_TOOL_NAMES, AI_CARD_TYPES, AI_LIMITS } from '../ai-assistant.constants.js';
import { toPlaceItem } from './tool-sanitizer.js';
import { placeLinks } from './plan-steps.js';

export const findNearbyPlacesTool = {
  declaration: {
    name: AI_TOOL_NAMES.FIND_NEARBY_PLACES,
    description:
      "Find kid-friendly places near the parent's home (from their profile location), optionally by type or keyword. " +
      'For a playdate being planned, prefer proposePlaydate / suggestPlaces (places between the families).',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: Object.values(PLACE_TYPES) },
        keyword: { type: 'string', description: 'Part of the name or address, e.g. "Gia Định"' },
        radiusKm: { type: 'integer', minimum: 1, maximum: AI_LIMITS.MAX_SEARCH_RADIUS_KM },
        limit: { type: 'integer', minimum: 1, maximum: AI_LIMITS.MAX_PLACES },
      },
    },
  },

  async execute(args, ctx) {
    const radiusKm = Math.min(AI_LIMITS.MAX_SEARCH_RADIUS_KM, Math.max(1, parseInt(args.radiusKm, 10) || 0)) || undefined;
    // Never lat/lng from the model: the center is always the parent's own profile location
    const { places } = await placesService.getNearbyPlaces(ctx.userId, {
      type: Object.values(PLACE_TYPES).includes(args.type) ? args.type : undefined,
      keyword: args.keyword ? String(args.keyword).slice(0, 100) : undefined,
      radius: radiusKm ? radiusKm * 1000 : undefined,
      limit: Math.min(AI_LIMITS.MAX_PLACES, Math.max(1, parseInt(args.limit, 10) || AI_LIMITS.MAX_PLACES)),
    });
    const items = places.slice(0, AI_LIMITS.MAX_PLACES).map(toPlaceItem);
    items.forEach((place) => ctx.turn.places.set(place.id, place));
    ctx.turn.cards.push({
      type: AI_CARD_TYPES.PLACE_SUGGESTIONS,
      items: items.map((place) => ({ ...place, links: placeLinks(place) })),
    });

    return {
      places: items.map((place) => ({
        id: place.id,
        name: place.name,
        type: place.placeType,
        address: place.address,
        distanceKm: place.distanceKm,
        openingHours: place.openingHours,
      })),
      ...(items.length ? {} : { note: 'No place found around the parent: say so, do not invent places.' }),
    };
  },
};

export default findNearbyPlacesTool;
