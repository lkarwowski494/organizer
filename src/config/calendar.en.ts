/**
 * Names for date display. Source: Unicode CLDR, en, ca-gregorian.
 * Day index: 0 = Monday (same as isoWeekday in src/domain/civil-date.ts).
 */
export const MONTHS_NOMINATIVE = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const WEEKDAYS_NOMINATIVE = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const WEEKDAYS_ABBREVIATED = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
