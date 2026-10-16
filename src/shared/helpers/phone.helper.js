const VN_COUNTRY_CODE = '84';

/**
 * Normalize a phone number to E.164 (the format Firebase Phone Auth returns),
 * so the same number is always stored and looked up the same way.
 * Numbers without a country code are treated as Vietnamese.
 *   0912345678    -> +84912345678
 *   84912345678   -> +84912345678
 *   +840912345678 -> +84912345678 (redundant trunk zero)
 *   912345678     -> +84912345678
 * @param {string|null|undefined} phone
 * @returns {string|null} E.164 phone, or null when empty
 */
export const normalizePhone = (phone) => {
  if (!phone) return null;
  let digits = String(phone).trim().replace(/[\s.\-()]/g, '');
  if (!digits) return null;

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = VN_COUNTRY_CODE + digits.slice(1);
  } else if (!(digits.startsWith(VN_COUNTRY_CODE) && digits.length >= 11)) {
    digits = VN_COUNTRY_CODE + digits;
  }

  if (digits.startsWith(`${VN_COUNTRY_CODE}0`)) {
    digits = VN_COUNTRY_CODE + digits.slice(VN_COUNTRY_CODE.length + 1);
  }

  return `+${digits}`;
};

export default normalizePhone;
