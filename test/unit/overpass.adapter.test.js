import { describe, it, expect } from '@jest/globals';
import {
  buildAreaQuery,
  mapElementToPlace,
  classifyPlaceType,
  buildAddressFromTags,
} from '../../src/integrations/maps/overpass.adapter.js';

describe('Overpass adapter helpers', () => {
  it('builds a bbox query for one type or for every type', () => {
    const parks = buildAreaQuery({ bbox: [16, 108.1, 16.1, 108.2], type: 'park' });
    expect(parks).toContain('[bbox:16.00000,108.10000,16.10000,108.20000]');
    expect(parks).toContain('nwr["leisure"="park"]["name"];');
    expect(parks).not.toContain('amenity');

    const all = buildAreaQuery({ bbox: [16, 108.1, 16.1, 108.2], timeoutSec: 180 });
    expect(all).toContain('[timeout:180]');
    expect(all).toContain('["amenity"="library"]');
    expect(all).toContain('["leisure"="indoor_play"]');
  });

  it('maps a way with a center and its address tags', () => {
    const place = mapElementToPlace({
      type: 'way',
      id: 512870334,
      center: { lat: 16.0598, lon: 108.2238 },
      tags: { leisure: 'park', name: 'APEC Park', 'name:vi': 'Công viên APEC', 'addr:street': 'Bạch Đằng', 'addr:city': 'Đà Nẵng', opening_hours: '05:00-22:00' },
    });
    expect(place).toMatchObject({
      osmId: 'osm-way-512870334',
      name: 'Công viên APEC',
      address: 'Bạch Đằng, Đà Nẵng',
      placeType: 'park',
      coordinates: { type: 'Point', coordinates: [108.2238, 16.0598] },
      openingHours: '05:00-22:00',
    });
    expect(place).not.toHaveProperty('rating');
  });

  it('skips unnamed or unsupported elements', () => {
    expect(mapElementToPlace({ type: 'node', id: 1, lat: 16, lon: 108, tags: { leisure: 'playground' } })).toBeNull();
    expect(mapElementToPlace({ type: 'node', id: 2, lat: 16, lon: 108, tags: { amenity: 'bar', name: 'Bar' } })).toBeNull();
  });

  it('classifies kids cafes by tag or by a children name', () => {
    expect(classifyPlaceType({ leisure: 'indoor_play' })).toBe('kids_cafe');
    expect(classifyPlaceType({ amenity: 'cafe', name: 'Kids Cafe Hải Châu' })).toBe('kids_cafe');
    expect(classifyPlaceType({ amenity: 'cafe', name: 'Cộng Cà Phê' })).toBeNull();
    expect(classifyPlaceType({ tourism: 'museum' })).toBe('workshop');
    expect(buildAddressFromTags({})).toBe('');
  });
});
