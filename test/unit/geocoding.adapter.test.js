import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import geocodingAdapter from '../../src/integrations/maps/geocoding.adapter.js';
import { publicDnsHttpsAgent } from '../../src/integrations/maps/public-dns.agent.js';

// Nominatim search results (shapes copied from real answers)
const wardResult = (name, lon, lat, addresstype = 'suburb') => ({
  class: 'boundary',
  type: 'administrative',
  addresstype,
  name,
  lon: String(lon),
  lat: String(lat),
  address: { suburb: name, city: 'Thành phố Đà Nẵng' },
});
const POLICE_IN_AN_HAI = {
  class: 'amenity',
  type: 'police',
  addresstype: 'amenity',
  name: 'Công an phường An Hải',
  lon: '108.2415',
  lat: '16.0662',
  address: { road: 'Đường Phước Mỹ 1', suburb: 'Phường An Hải', city: 'Thành phố Đà Nẵng' },
};
const CITY_RESULT = {
  class: 'boundary',
  type: 'administrative',
  addresstype: 'city',
  name: 'Thành phố Huế',
  lon: '107.5863',
  lat: '16.4639',
  address: { city: 'Thành phố Huế' },
};

describe('geocodingAdapter.getCoordinatesByAddress', () => {
  let get;

  beforeEach(() => {
    geocodingAdapter.requestIntervalMs = 0;
    get = jest.spyOn(geocodingAdapter.client, 'get');
  });

  afterEach(() => {
    get.mockRestore();
  });

  const searchedQueries = () => get.mock.calls.map(([, config]) => config.params.q);

  it('returns the center of the ward boundary (wards since 07/2025)', async () => {
    get.mockResolvedValueOnce({ data: [wardResult('Phường Hội An Đông', 108.364, 15.8786)] });

    expect(await geocodingAdapter.getCoordinatesByAddress('Phường Hội An Đông', 'Thành phố Đà Nẵng')).toEqual([108.364, 15.8786]);
    expect(searchedQueries()).toEqual(['Phường Hội An Đông, Thành phố Đà Nẵng, Việt Nam']);
  });

  it('accepts a ward whose boundary is a "town" (e.g. Phường Điện Bàn)', async () => {
    get.mockResolvedValueOnce({ data: [wardResult('Phường Điện Bàn', 108.2493, 15.8892, 'town')] });
    expect(await geocodingAdapter.getCoordinatesByAddress('Phường Điện Bàn', 'Đà Nẵng')).toEqual([108.2493, 15.8892]);
  });

  it('never uses a building or a POI as the ward center', async () => {
    // Skips the police station listed first and takes the ward boundary
    get.mockResolvedValueOnce({ data: [POLICE_IN_AN_HAI, wardResult('Phường An Hải', 108.2364, 16.0701)] });
    expect(await geocodingAdapter.getCoordinatesByAddress('Phường An Hải', 'Đà Nẵng')).toEqual([108.2364, 16.0701]);
  });

  it('maps a former ward to the center of the new ward that replaced it', async () => {
    get
      .mockResolvedValueOnce({ data: [POLICE_IN_AN_HAI] })
      .mockResolvedValueOnce({ data: [wardResult('Phường An Hải', 108.2364, 16.0701)] });

    expect(await geocodingAdapter.getCoordinatesByAddress('Phường Phước Mỹ', 'Thành phố Đà Nẵng')).toEqual([108.2364, 16.0701]);
    expect(searchedQueries()).toEqual([
      'Phường Phước Mỹ, Thành phố Đà Nẵng, Việt Nam',
      'Phường An Hải, Thành phố Đà Nẵng, Việt Nam',
    ]);
  });

  it('uses the city boundary when only the city is known', async () => {
    get.mockResolvedValueOnce({ data: [CITY_RESULT] });
    expect(await geocodingAdapter.getCoordinatesByAddress('', 'Thành phố Huế')).toEqual([107.5863, 16.4639]);
  });

  it('falls back to the city center when the ward cannot be found or Nominatim fails', async () => {
    get.mockResolvedValueOnce({ data: [] });
    expect(await geocodingAdapter.getCoordinatesByAddress('Phường Không Có', 'Thành phố Đà Nẵng')).toEqual([108.2022, 16.0544]);

    get.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND nominatim.openstreetmap.org'));
    expect(await geocodingAdapter.getCoordinatesByAddress('Phường Hải Châu', 'Hà Nội')).toEqual([105.8542, 21.0285]);
  });

  it('queries Nominatim in Vietnam only, through the public DNS agent', async () => {
    get.mockResolvedValueOnce({ data: [wardResult('Phường Hải Châu', 108.2195, 16.059)] });
    await geocodingAdapter.getCoordinatesByAddress('Phường Hải Châu', 'Đà Nẵng');

    expect(get.mock.calls[0][1].params).toMatchObject({ countrycodes: 'vn', addressdetails: 1 });
    // Router / ISP resolvers may not resolve nominatim.openstreetmap.org
    expect(geocodingAdapter.client.defaults.httpsAgent).toBe(publicDnsHttpsAgent);
    expect(geocodingAdapter.client.defaults.baseURL).toBe('https://nominatim.openstreetmap.org');
  });
});
