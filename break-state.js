export const donationBreaks = data => Object.values(data.donationBreaks || {});
// Dates remain excused after a break ends, including an early end today.
export const breakForDay = (data, day) => donationBreaks(data)
  .find(item => !item.cancelledAt && item.start <= day && day <= item.end);
export const activeBreak = (data, day) => donationBreaks(data)
  .find(item => !item.cancelledAt && !item.endedAt && item.start <= day && day <= item.end);
