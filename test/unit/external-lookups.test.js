import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import axios from 'axios';
import openMeteoAdapter from '../../src/integrations/weather/open-meteo.adapter.js';
import geminiAdapter from '../../src/integrations/ai/gemini.adapter.js';
import placesService from '../../src/modules/places/places.service.js';
import placeAttractionsService from '../../src/modules/places/place-attractions.service.js';
import tavilyAdapter from '../../src/integrations/search/tavily.adapter.js';
import env from '../../src/config/env.js';

const searchConfig = { ...env.ATTRACTION_SEARCH };
afterEach(() => {
  jest.restoreAllMocks();
  Object.assign(env.ATTRACTION_SEARCH, searchConfig);
});

describe('openMeteoAdapter.getDailyWeather (BUD-49 D2)', () => {
  // A new point per test: the adapter keeps answers for 3 hours
  let lat = 10;
  const nextPoint = () => {
    lat += 1;
    return [lat, 108.2];
  };
  const forecast = {
    time: ['2099-03-01', '2099-03-16'],
    weather_code: [95, 1],
    precipitation_probability_max: [100, 10],
    temperature_2m_max: [30, 33],
  };

  it('asks for the 16-day forecast and reads the day', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { daily: forecast } });
    const [la, lng] = nextPoint();
    expect(await openMeteoAdapter.getDailyWeather(la, lng, '2099-03-01')).toEqual({
      isRaining: true,
      precipitationProbability: 100,
      weatherCode: 95,
      maxTemp: 30,
    });
    expect(get.mock.calls[0][0]).toContain('forecast_days=16');
    expect((await openMeteoAdapter.getDailyWeather(la, lng, '2099-03-16')).isRaining).toBe(false);
  });

  it('gives no weather for a day past the forecast instead of a dry day', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { daily: forecast } });
    const [la, lng] = nextPoint();
    expect(await openMeteoAdapter.getDailyWeather(la, lng, '2099-04-01')).toBeNull();
  });

  it('gives no weather when Open-Meteo cannot be reached, and asks again next time', async () => {
    const get = jest.spyOn(axios, 'get').mockRejectedValueOnce(new Error('timeout'));
    const [la, lng] = nextPoint();
    expect(await openMeteoAdapter.getDailyWeather(la, lng, '2099-03-01')).toBeNull();
    get.mockResolvedValueOnce({ data: { daily: forecast } });
    expect((await openMeteoAdapter.getDailyWeather(la, lng, '2099-03-01')).isRaining).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('placeAttractionsService.getOrFetchAttractions with Google grounding (BUD-49 A4)', () => {
  const doc = { _id: 'place-1', name: 'TiNiWorld', address: 'Đà Nẵng', attractionsFetchedAt: null };
  beforeEach(() => {
    env.ATTRACTION_SEARCH.PROVIDER = 'google';
    jest.spyOn(placesService, 'getPlaceDocById').mockResolvedValue(doc);
  });

  it('does not cache a search that failed (quota 429), so the next plan tries again', async () => {
    const save = jest.spyOn(placesService, 'saveAttractions').mockResolvedValue();
    jest
      .spyOn(geminiAdapter, 'searchPlaceAttractions')
      .mockResolvedValue({ attractions: [], hasGrounding: false, sourceUrl: null, failed: true });

    expect(await placeAttractionsService.getOrFetchAttractions('place-1', doc)).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('caches what a search found', async () => {
    const found = [{ title: 'Nhà banh', description: '', sourceUrl: 'https://example.com' }];
    const save = jest.spyOn(placesService, 'saveAttractions').mockResolvedValue();
    jest.spyOn(geminiAdapter, 'searchPlaceAttractions').mockResolvedValue({ attractions: found, hasGrounding: true });

    expect(await placeAttractionsService.getOrFetchAttractions('place-1', doc)).toEqual(found);
    expect(save).toHaveBeenCalledWith('place-1', found);
  });

  it('caches an empty answer from a search that ran but found no web source', async () => {
    const save = jest.spyOn(placesService, 'saveAttractions').mockResolvedValue();
    jest.spyOn(geminiAdapter, 'searchPlaceAttractions').mockResolvedValue({ attractions: [], hasGrounding: false });

    expect(await placeAttractionsService.getOrFetchAttractions('place-1', doc)).toEqual([]);
    expect(save).toHaveBeenCalledWith('place-1', []);
  });
});

describe('placeAttractionsService.getOrFetchAttractions with Tavily (BUD-49 A4)', () => {
  const doc = { _id: 'place-2', name: 'TiNiWorld', address: 'Đà Nẵng', website: 'https://tiniworld.example', attractionsFetchedAt: null };
  const page = { title: 'TiNiWorld Đà Nẵng', url: 'https://review.example/tini', content: 'Có nhà banh và cầu trượt.' };
  let save;
  beforeEach(() => {
    env.ATTRACTION_SEARCH.PROVIDER = 'tavily';
    env.ATTRACTION_SEARCH.TAVILY_API_KEY = 'tvly-test';
    jest.spyOn(placesService, 'getPlaceDocById').mockResolvedValue(doc);
    save = jest.spyOn(placesService, 'saveAttractions').mockResolvedValue();
  });

  it('reads the games of the found pages, each with the page that names it', async () => {
    const search = jest.spyOn(tavilyAdapter, 'search').mockResolvedValue([page]);
    jest.spyOn(geminiAdapter, 'generateContent').mockResolvedValue({
      text: '[{"title":"Nhà banh","description":"Bể banh lớn","source":1},{"title":"Bịa ra","source":7}]',
    });

    const found = await placeAttractionsService.getOrFetchAttractions('place-2', doc);
    expect(found).toEqual([{ title: 'Nhà banh', description: 'Bể banh lớn', sourceUrl: page.url }]);
    expect(search.mock.calls[0][0]).toBe('TiNiWorld Đà Nẵng trò chơi cho trẻ em');
    expect(save).toHaveBeenCalledWith('place-2', found);
  });

  it("reads the place's own website when the search finds nothing", async () => {
    jest.spyOn(tavilyAdapter, 'search').mockResolvedValue([]);
    const extract = jest.spyOn(tavilyAdapter, 'extract').mockResolvedValue([{ ...page, url: doc.website }]);
    jest.spyOn(geminiAdapter, 'generateContent').mockResolvedValue({ text: '[{"title":"Cầu trượt","source":1}]' });

    const found = await placeAttractionsService.getOrFetchAttractions('place-2', doc);
    expect(extract).toHaveBeenCalledWith([doc.website]);
    expect(found).toEqual([{ title: 'Cầu trượt', description: '', sourceUrl: doc.website }]);
  });

  it('caches an empty answer when no page talks about the place', async () => {
    jest.spyOn(tavilyAdapter, 'search').mockResolvedValue([]);
    jest.spyOn(tavilyAdapter, 'extract').mockResolvedValue([]);
    const generate = jest.spyOn(geminiAdapter, 'generateContent');

    expect(await placeAttractionsService.getOrFetchAttractions('place-2', doc)).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('place-2', []);
  });

  it('does not cache when Tavily or Gemini fails, or when there is no Tavily key', async () => {
    jest.spyOn(tavilyAdapter, 'search').mockRejectedValueOnce(new Error('Request failed with status code 432'));
    expect(await placeAttractionsService.getOrFetchAttractions('place-2', doc)).toEqual([]);

    jest.spyOn(tavilyAdapter, 'search').mockResolvedValue([page]);
    jest.spyOn(geminiAdapter, 'generateContent').mockRejectedValue(new Error('AI assistant is busy'));
    expect(await placeAttractionsService.getOrFetchAttractions('place-2', doc)).toEqual([]);

    env.ATTRACTION_SEARCH.TAVILY_API_KEY = '';
    expect(await placeAttractionsService.getOrFetchAttractions('place-2', doc)).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });
});
