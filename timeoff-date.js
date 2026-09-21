import { validDay } from './tracking.js';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthNames = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const monthAliases = new Map([
  ['sepetember', 8],
  ['septemper', 8],
]);

export function formatTimeoffDate(day) {
  return `${Number(day.slice(8))} ${months[Number(day.slice(5, 7)) - 1]}`;
}

export function parseTimeoffDate(value, today) {
  // Keep accepting ISO dates for existing users and explicit future years.
  if (validDay(value)) return value;
  const match = /^(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2}))$/i.exec(value.trim());
  const day = match?.[1] ?? match?.[4];
  const monthText = (match?.[2] ?? match?.[3])?.toLowerCase();
  let month = monthText ? monthNames.findIndex(name => name === monthText || name.slice(0, 3) === monthText) : -1;
  if (month === -1 && monthText) month = monthAliases.get(monthText) ?? -1;
  if (month !== -1) {
    const date = `${today.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
    if (validDay(date)) return date;
  }
  throw new Error('Enter a day and month, like 10 Sep, 10 September, or Sep 10.');
}
