/* ================================================================
   class-settings.js — the teacher dashboard's switches, as the game
   sees them.

   The dashboard (teacher.html) writes settings/{period}:
     closedBuildings: { <building id>: true }   workshop doors that stay shut
     closedBenches:   { <bench id>: true }      benches that won't open
     questionsOff:    { <question key>: true }  battle/Dojo question types off
   Only what is switched OFF is stored, so a period with no settings --
   or a game that can't read them -- plays exactly as it did before the
   dashboard existed: everything open. Not being able to read settings
   must never lock a class out mid-lesson.

   The game watches its own period's settings live, so a workshop closed
   from the dashboard shuts its door for students already playing.
   These are checks in the student's browser, which is enough for a
   classroom but can be got round by someone who knows the dev tools.
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const ClassSettings = (function () {
  'use strict';
  let current = {};
  let ref = null;

  function apply(data) { current = data && typeof data === 'object' ? data : {}; }

  // Start following one period's settings (call again on a new login).
  function watch(period) {
    if (ref) { try { ref.off(); } catch (e) { /* already gone */ } ref = null; }
    apply(null);
    if (!period || !Shared.DB_OK) return;
    try {
      ref = Shared.DB.ref('settings/' + period);
      ref.on('value', snap => apply(snap.val()), err => {
        console.warn('[ClassSettings] could not read settings; everything stays open', err);
        apply(null);
      });
    } catch (e) { console.warn('[ClassSettings] watch failed; everything stays open', e); }
  }

  const on = (group, id) => !!(current[group] && current[group][id]);
  return {
    watch,
    set: apply, // for tests
    buildingClosed: id => on('closedBuildings', id),
    benchClosed: id => on('closedBenches', id),
    questionOn: key => !on('questionsOff', key),
  };
})();
