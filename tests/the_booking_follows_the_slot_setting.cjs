/* The Admin Portal booking page follows the office's Collection Time Slot
   setting, lunch break included. Drives the SHIPPED src/lib/collectionSlots.js
   (its one import stubbed) and reads the page for the wiring. */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
function ok(name, cond, got) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name + (got !== undefined ? ' -> got ' + JSON.stringify(got) : '')); } }

const libPath = path.join(__dirname, '..', 'src', 'lib', 'collectionSlots.js');
const pagePath = path.join(__dirname, '..', 'src', 'pages', 'Booking.jsx');
if (!fs.existsSync(libPath)) { ok('src/lib/collectionSlots.js exists', false); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }

let src = fs.readFileSync(libPath, 'utf8').replace(/^import .*$/m, '').replace(/^export /gm, '');
const names = ['slots', 'applySlotRow', 'hasLunch', 'isLunch', 'crossesLunch', 'dayHours', 'bookableHours', 'closingHour', 'hoursNeeded'];
const L = new Function('supabase', src + ';return {' + names.join(',') + '};')(null);

console.log('1. With no setting the page books as it always did');
ok('weekday 8 to 4', JSON.stringify(L.bookableHours(1)) === '[8,9,10,11,12,13,14,15,16]', L.bookableHours(1));
ok('Saturday 8 to 11', JSON.stringify(L.bookableHours(6)) === '[8,9,10,11]', L.bookableHours(6));
ok('Sunday closed', L.bookableHours(0).length === 0);
ok('700 seedlings take 2 hours at 350', L.hoursNeeded(700) === 2);
ok('no lunch', !L.hasLunch());

console.log('2. A bad row changes nothing');
ok('closing before opening is refused', L.applySlotRow({ weekday_open: 10, weekday_close: 9, sat_open: 8, sat_close: 12 }) === false);
ok('hours unchanged', L.closingHour(1) === 17);

console.log('3. The office setting, lunch 12 to 2');
ok('row applied', L.applySlotRow({ weekday_open: 8, weekday_close: 17, sat_open: 8, sat_close: 12, rate_per_hour: 350, lunch_start: 12, lunch_end: 14 }) === true);
ok('12 and 1 are not offered', JSON.stringify(L.bookableHours(1)) === '[8,9,10,11,14,15,16]', L.bookableHours(1));
ok('Saturday closing at 12 is untouched', JSON.stringify(L.bookableHours(6)) === '[8,9,10,11]');
ok('11 to 1 runs into lunch', L.crossesLunch(11, 13));
ok('9 to 11 does not', !L.crossesLunch(9, 11));
ok('2 to 4 does not', !L.crossesLunch(14, 16));
ok('11 to 12 does not', !L.crossesLunch(11, 12));

console.log('4. Other hours and rate');
L.applySlotRow({ weekday_open: 7, weekday_close: 15, sat_open: 9, sat_close: 13, rate_per_hour: 500, lunch_start: null, lunch_end: null });
ok('weekday 7 to 2', JSON.stringify(L.bookableHours(2)) === '[7,8,9,10,11,12,13,14]');
ok('closing 3 PM', L.closingHour(2) === 15);
ok('lunch cleared', !L.hasLunch());
ok('1,000 at 500 is 2 hours', L.hoursNeeded(1000) === 2);

console.log('5. The page uses it');
const page = fs.readFileSync(pagePath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('no fixed hour list left', !/HOURS_WEEKDAY|HOURS_SAT|\[8, 9, 10, 11/.test(page));
ok('no fixed rate left', !/const RATE\s*=/.test(page));
ok('loads the setting', /loadSlotSettings\(\)/.test(page));
ok('offers bookableHours', (page.match(/bookableHours\(/g) || []).length >= 2);
ok('save and edit both refuse lunch and closing', (page.match(/slotProblem\(/g) || []).length >= 3 && /crossesLunch\(/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
