import { validDay } from './tracking.js';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTimeoffDate(day) {
  return `${Number(day.slice(8))} ${months[Number(day.slice(5, 7)) - 1]}`;
}

export function parseTimeoffDate(value, today) {
  // Keep accepting ISO dates for existing users and explicit future years.
  if (validDay(value)) return value;
  const match = /^(\d{1,2})\s+([a-z]{3})$/i.exec(value.trim());
  const month = match ? months.findIndex(name => name.toLowerCase() === match[2].toLowerCase()) : -1;
  if (month !== -1) {
    const date = `${today.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    if (validDay(date)) return date;
  }
  throw new Error('Enter a day and the first three letters of the month, like 16 Sep (current year).');
}
