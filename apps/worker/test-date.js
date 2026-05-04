const { fromZonedTime } = require('date-fns-tz');
const { parseISO, isValid } = require('date-fns');

const d1 = fromZonedTime("2026-05-04 10:00", "America/Mexico_City");
const d2 = fromZonedTime("18/05/2026", "America/Mexico_City");
const d3 = fromZonedTime("2026-05-04T10:00:00", "America/Mexico_City");

console.log("d1 valid?", isValid(d1), d1);
console.log("d2 valid?", isValid(d2), d2);
console.log("d3 valid?", isValid(d3), d3);
