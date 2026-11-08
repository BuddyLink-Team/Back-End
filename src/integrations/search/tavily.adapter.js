import axios from 'axios';
import env from '../../config/env.js';

// Text sent on to Gemini per page: enough for a list of games, small enough to keep the call cheap
const MAX_CONTENT_LENGTH = 3000;

const isConfigured = () => {
  const key = env.ATTRACTION_SEARCH.TAVILY_API_KEY;
  return Boolean(key && !key.startsWith('<'));
};

const toSource = ({ title = '', url = '', content = '', raw_content: rawContent = '' } = {}) => ({
  title: String(title || '').trim(),
  url: String(url || '').trim(),
  content: String(rawContent || content || '').trim().slice(0, MAX_CONTENT_LENGTH),
});

/**
 * Tavily web search (BUD-49 A4): finds pages about a place for the Gemini free tier, which has no Google Search grounding.
 * The pages are fetched by Tavily, so the server never opens a URL taken from map data.
 * Errors are thrown: the caller decides whether an empty answer may be cached.
 */
class TavilyAdapter {
  get isConfigured() {
    return isConfigured();
  }

  /** @private */
  async _post(path, body) {
    const response = await axios.post(`${env.ATTRACTION_SEARCH.TAVILY_API_URL}${path}`, body, {
      headers: { Authorization: `Bearer ${env.ATTRACTION_SEARCH.TAVILY_API_KEY}` },
      timeout: env.ATTRACTION_SEARCH.TIMEOUT_MS,
    });
    return response.data || {};
  }

  /**
   * Search the web (1 credit per call).
   * @param {string} query
   * @param {{ maxResults?: number }} [options]
   * @returns {Promise<Array<{ title: string, url: string, content: string }>>}
   */
  async search(query, { maxResults = 5 } = {}) {
    const data = await this._post('/search', {
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: false,
    });
    return (data.results || []).map(toSource).filter((source) => source.url && source.content);
  }

  /**
   * Read the text of given pages, e.g. the website of a place (1 credit per 5 pages).
   * @param {string[]} urls
   * @returns {Promise<Array<{ title: string, url: string, content: string }>>}
   */
  async extract(urls) {
    const data = await this._post('/extract', { urls, extract_depth: 'basic' });
    return (data.results || []).map(toSource).filter((source) => source.url && source.content);
  }
}

export const tavilyAdapter = new TavilyAdapter();
export default tavilyAdapter;
