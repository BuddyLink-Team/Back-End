import { PAGINATION } from '../../shared/constants/index.js';
import { getZonedDayRange } from '../../shared/helpers/date.helper.js';

/**
 * Query string values arrive as strings ('true' / 'false'); absent means "no filter"
 */
export const toOptionalBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true';
};

export const toOptionalInt = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const number = parseInt(value, 10);
  return Number.isInteger(number) ? number : undefined;
};

export const toPaging = ({ page, limit }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || PAGINATION.DEFAULT_PAGE);
  const limitNum = Math.min(
    PAGINATION.MAX_LIMIT,
    Math.max(1, parseInt(limit, 10) || PAGINATION.DEFAULT_LIMIT)
  );
  return { page: pageNum, limit: limitNum };
};

export const toPagination = ({ page, limit }, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 1,
});

/**
 * Query date as an instant. A 'YYYY-MM-DD' day is taken in APP_TIMEZONE:
 * its start for a lower bound, its end for an upper bound.
 */
export const toDateBound = (value, { endOfDay = false } = {}) => {
  if (!value) return undefined;
  if (typeof value === 'string' && value.length === 10) {
    const { start, end } = getZonedDayRange(value);
    return endOfDay ? end : start;
  }
  return new Date(value);
};

export const intersectIds = (first, second) => {
  if (!first) return second;
  if (!second) return first;
  const secondSet = new Set(second.map(String));
  return first.filter((id) => secondSet.has(String(id)));
};

export const toPercent = (part, whole) =>
  whole > 0 ? Number(((part / whole) * 100).toFixed(1)) : 0;
