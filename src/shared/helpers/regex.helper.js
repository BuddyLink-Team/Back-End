/**
 * Escape characters that have a special meaning in a regular expression,
 * so user input can be matched literally.
 * @param {string} value
 * @returns {string}
 */
export const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default escapeRegExp;
