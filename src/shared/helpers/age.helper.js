/**
 * Calculate a child's age in whole years (calendar based, UTC like stored dates of birth).
 * @param {Date|string} dateOfBirth
 * @param {Date} [now=new Date()]
 * @returns {number|null} Age in years, or null when the date is missing or invalid
 */
export const calculateAgeYears = (dateOfBirth, now = new Date()) => {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (Number.isNaN(birthDate.getTime())) return null;

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return Math.max(0, age);
};

export default calculateAgeYears;
