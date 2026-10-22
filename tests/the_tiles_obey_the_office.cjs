/* THE ADMIN PORTAL'S SCREENS NOW HAVE TICKS, AND A TICK NOBODY OBEYS
   IS WORSE THAN NO TICK.

   555 MJM Team -> User Access -> Admin Portal writes
   `permissions.mobile_actions.<page>.view` on the person's profile — the same
   shape every other module on that site stores per-page access in. Until
   this change the portal read none of it: hasOpsAccess() let anybody holding
   ANY staff-grade module into all three screens, so the office could tick
   whatever it liked and the phone would open the door anyway.

   Three things this holds, and the first is the one that could hurt somebody:

   ABSENT IS A YES. These tiles have been open to every ops account since the
   app was written. The day a screen to tick them appears they must not close
   themselves — "nobody has been asked" is not "no", which is the house rule
   everywhere in this system. They close when somebody actually unticks one.

   THE TILE AND THE DOOR BEHIND IT ASK THE SAME QUESTION. A tile drawn over a
   page that would refuse is a trap; a page open with no tile is access
   nobody can see. So the keys on the dashboard's `modules` list and the ones
   named on each page's AuthGate have to be the same list.

   A REFUSED PAGE IS NOT AN EJECTION. Somebody who holds the portal and not
   one screen of it goes back to the dashboard, where their other tiles are —
   auth.html is the Pending Access notice and means something else entirely.

   Run: node tests/the_tiles_obey_the_office.cjs                            */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ok   ' + name + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL ' + name + '\n         got  ' + JSON.stringify(got) +
                             '\n         want ' + JSON.stringify(want)); }
}

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

/* The real function, lifted out of the shipped file rather than copied here.
   A copy would go on passing after the original changed, which is the one
   thing a test of a rule must not do. */
function liftCanOpen() {
  const src = read('src/lib/auth.js');
  const at = src.indexOf('export function canOpenAdminPage');
  if (at === -1) throw new Error('canOpenAdminPage is not in src/lib/auth.js any more');
  // To the end of the function: its own closing brace at column 0.
  const end = src.indexOf('\n}', at);
  const body = src.slice(at, end + 2).replace('export function', 'function');
  // eslint-disable-next-line no-new-func
  return new Function(body + '; return canOpenAdminPage;')();
}

const canOpenAdminPage = liftCanOpen();
const perms = (mobile_actions) => ({ permissions: { mobile_actions } });

console.log('\n── 1. Absent is a yes ──');
{
  check('nobody has been asked about this person at all',
        canOpenAdminPage(null, 'consent'), true);
  check('a profile with no mobile_actions',
        canOpenAdminPage({ permissions: { modules: { mobile: 'normal' } } }, 'consent'), true);
  check('a mobile_actions that names the OTHER screens',
        canOpenAdminPage(perms({ booking: { view: false } }), 'consent'), true);
  /* The read can fail — no signal, a refusal, a blip. loadOpsProfile answers
     null for all of them, and null draws the portal as it has always been. A
     check that cannot run must not take a module away from somebody who was
     working fine a minute ago. */
  check('and a profile that could not be read', canOpenAdminPage(null, 'booking'), true);
}

console.log('\n── 2. An explicit no is a no ──');
{
  check('unticked closes it', canOpenAdminPage(perms({ consent: { view: false } }), 'consent'), false);
  check('ticked opens it',    canOpenAdminPage(perms({ consent: { view: true } }), 'consent'), true);
  check('and it closes only the screen it names',
        canOpenAdminPage(perms({ consent: { view: false } }), 'do_signing'), true);
  /* A value that is not an object at all — a row half-written by hand, or an
     older shape — falls back to the yes rather than locking somebody out of
     a portal over a corrupted field. Same direction as everything above. */
  check('a value that is not an entry is not a refusal',
        canOpenAdminPage(perms({ consent: 'nope' }), 'consent'), true);
}

console.log('\n── 3. The tile and the door behind it ask the same question ──');
{
  const WANT = ['do_signing', 'consent', 'booking', 'seal'];

  const dash = read('src/pages/Index.jsx');
  const tiles = [...dash.matchAll(/\{\s*page:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  check('the dashboard draws a tile per screen, each naming its key', tiles, WANT);
  check('and filters them on the office’s answer',
        /\.filter\(\(m\) => canOpenAdminPage\(profile, m\.page\)\)/.test(dash), true);

  const gates = ['src/pages/DoSigning.jsx', 'src/pages/Consent.jsx',
                 'src/pages/Booking.jsx', 'src/pages/Seal.jsx']
    .map((f) => (read(f).match(/<AuthGate page="([a-z_]+)"/) || [])[1]);
  check('every page guards itself, under the same key its tile carries',
        gates.sort(), WANT.slice().sort());
}

console.log('\n── 4. A refused screen sends them to the dashboard, not out ──');
{
  const gate = read('src/components/AuthGate.jsx');
  check('no ops access at all is still the Pending Access notice',
        /if \(!inPortal\) \{\s*window\.location\.replace\('auth\.html'\);/.test(gate), true);
  check('but a screen they may not open sends them back to their other tiles',
        /if \(!ok\) \{\s*window\.location\.replace\('index\.html'\);/.test(gate), true);
}

console.log('\n' + (fail ? 'FAILURES: ' + fail + ' (passed ' + pass + ')'
                         : 'all good — ' + pass + ' checks'));
process.exit(fail ? 1 : 0);
