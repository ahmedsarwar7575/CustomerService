import processCallOutcome from './summerize.js';

const qaPairs = [
  { q: "Are you happy with the service?", a: "No I'm not, payouts are always late." },
  { q: "Do you want a follow up call from an agent?", a: "Yes please call me today." }
];

const userId = 1;
const callSid = "CA1234567890";

const result = await processCallOutcome({ qaPairs, userId, callSid });
console.log(result);
