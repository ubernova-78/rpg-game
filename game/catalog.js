/* ================================================================
   catalog.js — the workshops, benches and battle question types the
   teacher dashboard can switch on and off, with the names it shows.

   Loaded by both the game (index.html) and teacher.html. The ids must
   match the game's own: building ids in BUILDING_DEFS, bench ids in
   INTERIOR_OBJECTS (world.js), and question keys in QUESTION_MODULES
   (placevalue.js, measure.js). The game checks that at load
   (validateContent in npcs.js), so a bench added to the map but not
   listed here shows up as a console error rather than as a bench the
   teacher can't close.
   ================================================================ */

// eslint-disable-next-line no-unused-vars
const CATALOG = {
  workshops: [
    { id: 'red', label: 'Measure Distance Workshop', benches: [
      { id: 'unitBench',     label: 'Choose the Right Unit' },
      { id: 'mmBench',       label: 'Measure to the Millimeter' },
      { id: 'cmBench',       label: 'Measure to the Centimeter' },
      { id: 'mBench',        label: 'Measure to the Meter' },
      { id: 'mixedBench',    label: 'Mixed Practice' },
      { id: 'roundingBench', label: 'Rounding to Hundredths' },
      { id: 'averageBench',  label: 'Average Distance' },
      { id: 'measAvgBench',  label: 'Measure & Average Distance' },
    ] },
    { id: 'blue', label: 'Place Value Workshop', benches: [
      { id: 'placevalue', label: 'Place Value' },
    ] },
    { id: 'elapsed', label: 'Elapsed Time Workshop', benches: [
      { id: 'simpleBench',    label: 'Simple Elapsed Time' },
      { id: 'startstopBench', label: 'Start & Stop Time' },
    ] },
    { id: 'mvd', label: 'Mass, Volume & Density Workshop', benches: [
      { id: 'massBench',    label: 'Mass' },
      { id: 'dimsBench',    label: 'Find the 3 Dimensions' },
      { id: 'volumeBench',  label: 'Volume' },
      { id: 'densityBench', label: 'Density' },
    ] },
  ],
  // Monster battles and Dojo duels share this one list (Nick, 2026-11-03).
  questions: [
    { key: 'place-value-read',   label: 'Place value: read the number' },
    { key: 'place-value-build',  label: 'Place value: build the number' },
    { key: 'place-value-point',  label: 'Place value: place the decimal point' },
    { key: 'measure-unit',       label: 'Measurement: choose the right unit' },
    { key: 'measure-mm-read',    label: 'Measurement: read a ruler to the millimeter' },
    { key: 'measure-mm-caliper', label: 'Measurement: read calipers' },
  ],
  periods: ['2', '6', '7'],
};
