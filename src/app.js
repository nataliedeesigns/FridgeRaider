import {
  CATALOG,
  RECIPES,
  STAPLE_IDS,
  buildKitchen,
  findRecipes,
  labelFor,
  parseIngredientText,
  planRecipe,
  renderSteps,
  searchIngredients,
  suggestionsFor,
  textName,
} from './engine.js';
import { CATEGORIES, CUSTOM_KINDS } from './data/ingredients.js';

/* ------------------------------------------------------------------ */
/* State & persistence                                                 */
/* ------------------------------------------------------------------ */

const STORE_KEY = 'fridgeraider:v1';

const QUICK_ADD = [
  'egg', 'butter', 'milk', 'garlic', 'onion', 'cheddar', 'pasta', 'rice', 'cooked-rice', 'bread', 'flour', 'sugar',
  'soy-sauce', 'olive-oil', 'lemon', 'canned-tomatoes', 'tomato-paste', 'broth', 'chickpeas', 'black-beans', 'tuna',
  'peanut-butter', 'oats', 'potato', 'carrot', 'peas', 'spinach', 'tortilla', 'yogurt', 'honey',
  'vinegar', 'chili-flakes', 'cumin', 'paprika', 'italian-seasoning', 'baking-powder', 'cornstarch', 'mayo',
  'mustard', 'hot-sauce', 'parmesan', 'instant-ramen', 'mixed-veg', 'banana', 'apple',
].filter((id) => CATALOG.has(id));

const SAMPLE = [
  ['egg'], ['cooked-rice', true], ['onion'], ['garlic'], ['carrot'], ['spinach', true], ['cheddar'],
  ['tortilla'], ['black-beans'], ['soy-sauce'], ['butter'], ['milk'], ['bread'], ['banana', true], ['peas'],
];

function defaultState() {
  return {
    pantry: STAPLE_IDS.map((id) => ({ id })),
    custom: {},
    filters: { meal: 'any', diet: 'any', maxMinutes: 0 },
    seed: 0,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return { ...defaultState(), ...data, filters: { ...defaultState().filters, ...data.filters } };
  } catch {
    return defaultState();
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode) — app still works for this session */
  }
}

const has = (id) => state.pantry.some((p) => p.id === id);
const ingredientOf = (id) => CATALOG.get(id) || state.custom[id];

/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

let toastTimer;
function toast(message, action) {
  const el = $('#toast');
  el.replaceChildren(message);
  if (action) el.append(h('button', { type: 'button', onclick: () => { action.run(); el.hidden = true; } }, action.label));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 6000 : 3000);
}

/* ------------------------------------------------------------------ */
/* Pantry mutations                                                    */
/* ------------------------------------------------------------------ */

function addItems(entries) {
  const added = [];
  for (const { id, label } of entries) {
    if (has(id)) continue;
    state.pantry.push(label ? { id, label } : { id });
    added.push(id);
  }
  if (added.length) {
    save();
    render();
  }
  return added;
}

function removeItem(id) {
  const before = state.pantry;
  state.pantry = state.pantry.filter((p) => p.id !== id);
  save();
  render();
  const ing = ingredientOf(id);
  toast(`Removed ${ing ? ing.name : id}`, { label: 'Undo', run: () => { state.pantry = before; save(); render(); } });
}

function toggleSoon(id) {
  const item = state.pantry.find((p) => p.id === id);
  if (!item) return;
  item.useSoon = !item.useSoon;
  save();
  render();
}

function addCustom(text, kind) {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  const id = `custom-${slug}`;
  state.custom[id] = { id, name: text.charAt(0).toUpperCase() + text.slice(1), category: kind.category, tags: kind.tags, synonyms: [] };
  addItems([{ id }]);
}

/* ------------------------------------------------------------------ */
/* Add form: autocomplete + free text                                  */
/* ------------------------------------------------------------------ */

const input = $('#add-input');
const suggestList = $('#suggest-list');
let suggestions = [];
let activeIndex = -1;

function closeSuggest() {
  suggestList.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  activeIndex = -1;
}

function updateSuggest() {
  const q = input.value;
  // A list is being typed or pasted — don't autocomplete individual words.
  if (!q.trim() || /[,;\n]|\sand\s/i.test(q)) {
    suggestions = [];
    closeSuggest();
    return;
  }
  const exclude = new Set(state.pantry.map((p) => p.id));
  suggestions = searchIngredients(q, { exclude, limit: 7 });
  if (!suggestions.length) return closeSuggest();
  suggestList.replaceChildren(
    ...suggestions.map((s, i) =>
      h(
        'li',
        {
          id: `sugg-${i}`,
          role: 'option',
          'aria-selected': i === activeIndex ? 'true' : 'false',
          onmousedown: (e) => {
            e.preventDefault();
            pickSuggestion(i);
          },
        },
        h('span', {}, s.ing.name),
        s.via ? h('span', { class: 'via' }, s.via) : null,
      ),
    ),
  );
  suggestList.hidden = false;
  input.setAttribute('aria-expanded', 'true');
}

function pickSuggestion(i) {
  const s = suggestions[i];
  if (!s) return;
  addItems([{ id: s.ing.id, label: s.via ? labelFor(s.via, s.ing.id) : null }]);
  toast(`Added ${s.via || s.ing.name}`);
  input.value = '';
  closeSuggest();
  input.focus();
}

input.addEventListener('input', () => {
  activeIndex = -1;
  updateSuggest();
});

input.addEventListener('keydown', (e) => {
  if (suggestList.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    updateSuggest();
    input.setAttribute('aria-activedescendant', `sugg-${activeIndex}`);
  } else if (e.key === 'Escape') {
    closeSuggest();
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    e.preventDefault();
    pickSuggestion(activeIndex);
  }
});

input.addEventListener('blur', () => setTimeout(closeSuggest, 100));

// Pasting a multi-line list into a single-line input would drop the newlines.
input.addEventListener('paste', (e) => {
  const text = e.clipboardData?.getData('text') || '';
  if (/\n/.test(text.trim())) {
    e.preventDefault();
    handleText(text);
  }
});

$('#add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!input.value.trim()) return;
  handleText(input.value);
});

function handleText(text) {
  const { matched, unknown } = parseIngredientText(text);
  const fresh = matched.filter((m) => !has(m.id));
  addItems(fresh.map((m) => ({ id: m.id, label: m.label })));
  input.value = '';
  closeSuggest();
  if (fresh.length) {
    toast(`Added ${fresh.length} item${fresh.length > 1 ? 's' : ''}`);
  } else if (matched.length && !unknown.length) {
    toast('Already in your kitchen');
  }
  showUnknown(unknown);
}

let pendingUnknown = [];
function showUnknown(list) {
  pendingUnknown = [...new Set([...pendingUnknown, ...list])];
  renderUnknown();
}

function renderUnknown() {
  const box = $('#unknown-box');
  box.hidden = !pendingUnknown.length;
  box.replaceChildren(
    ...pendingUnknown.map((text) =>
      h(
        'div',
        { class: 'unknown-item' },
        h('p', {}, 'Not sure what ', h('strong', {}, `“${text}”`), ' is. What kind of thing is it?'),
        h(
          'div',
          { class: 'kind-row' },
          CUSTOM_KINDS.map((kind) =>
            h('button', { type: 'button', onclick: () => { pendingUnknown = pendingUnknown.filter((t) => t !== text); addCustom(text, kind); renderUnknown(); } }, kind.label),
          ),
          h('button', { type: 'button', onclick: () => { pendingUnknown = pendingUnknown.filter((t) => t !== text); renderUnknown(); } }, 'Skip'),
        ),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Kitchen panel                                                       */
/* ------------------------------------------------------------------ */

function renderPantry() {
  const items = state.pantry.map((p) => ({ ...p, ing: ingredientOf(p.id) })).filter((p) => p.ing);
  $('#pantry-count').textContent = items.length;
  const onlyStaples = items.every((p) => STAPLE_IDS.includes(p.id));
  $('#pantry-empty').hidden = !onlyStaples;
  $('#pantry-legend').hidden = onlyStaples;

  const groups = CATEGORIES.map((cat) => ({
    cat,
    items: items.filter((p) => (p.ing.category || 'Other') === cat).sort((a, b) => a.ing.name.localeCompare(b.ing.name)),
  })).filter((g) => g.items.length);

  $('#pantry').replaceChildren(
    ...groups.map((g) =>
      h(
        'div',
        { class: 'cat' },
        h('h3', {}, g.cat),
        h(
          'div',
          { class: 'chips' },
          g.items.map((p) => {
            const name = p.label ? p.label.charAt(0).toUpperCase() + p.label.slice(1) : p.ing.name;
            return h(
              'span',
              { class: `chip${p.useSoon ? ' soon' : ''}` },
              name,
              g.cat !== 'Basics'
                ? h('button', {
                    type: 'button',
                    class: 'icon-btn soon-btn',
                    'aria-pressed': p.useSoon ? 'true' : 'false',
                    'aria-label': `Use ${name} soon`,
                    title: p.useSoon ? 'Using soon — tap to unmark' : 'Use soon?',
                    onclick: () => toggleSoon(p.id),
                  }, '⏰')
                : null,
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${name}`, title: 'Remove', onclick: () => removeItem(p.id) }, '✕'),
            );
          }),
        ),
      ),
    ),
  );

  const quick = QUICK_ADD.filter((id) => !has(id)).slice(0, 30);
  $('#quick-add').replaceChildren(
    ...quick.map((id) =>
      h('button', { type: 'button', onclick: () => { addItems([{ id }]); toast(`Added ${CATALOG.get(id).name}`); } }, '+ ', CATALOG.get(id).name),
    ),
  );
}

$('#sample-btn').addEventListener('click', () => {
  state.pantry = [
    ...STAPLE_IDS.map((id) => ({ id })),
    ...SAMPLE.filter(([id]) => CATALOG.has(id)).map(([id, useSoon]) => (useSoon ? { id, useSoon } : { id })),
  ];
  save();
  render();
  toast('Loaded a sample fridge — tweak it to match yours');
});

$('#clear-btn').addEventListener('click', () => {
  const before = state.pantry;
  state.pantry = STAPLE_IDS.map((id) => ({ id }));
  save();
  render();
  toast('Kitchen cleared', { label: 'Undo', run: () => { state.pantry = before; save(); render(); } });
});

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

const mealButtons = [...document.querySelectorAll('#meal-filter button')];
mealButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    state.filters.meal = btn.dataset.meal;
    save();
    render();
  }),
);
$('#diet-filter').addEventListener('change', (e) => {
  state.filters.diet = e.target.value;
  save();
  render();
});
$('#time-filter').addEventListener('change', (e) => {
  state.filters.maxMinutes = Number(e.target.value);
  save();
  render();
});
$('#remix-btn').addEventListener('click', () => {
  state.seed = (state.seed + 1) % 10000;
  save();
  render();
  toast('Shuffled ingredient combos');
});

function syncFilters() {
  mealButtons.forEach((b) => b.setAttribute('aria-checked', b.dataset.meal === state.filters.meal ? 'true' : 'false'));
  $('#diet-filter').value = state.filters.diet;
  $('#time-filter').value = String(state.filters.maxMinutes);
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

function kitchen() {
  return buildKitchen(state.pantry, state.custom);
}

function nameOf(item) {
  return textName(item, item.label);
}

function recipeMeta(r) {
  return `${r.minutes} min · ${r.difficulty} · serves ${r.servings}`;
}

function renderResults() {
  const k = kitchen();
  const nonStaple = k.filter((i) => !i.tags.has('staple'));
  const { ready, almost } = findRecipes(k, { ...state.filters, seed: state.seed });
  const grid = $('#ready-grid');
  const summary = $('#results-summary');

  if (!nonStaple.length) {
    summary.textContent = '';
    grid.replaceChildren(
      h(
        'div',
        { class: 'empty-state' },
        h('div', { class: 'big', 'aria-hidden': 'true' }, '🥕🥚🧀'),
        h('h3', {}, 'What’s in your fridge?'),
        h('p', {}, 'Add the ingredients you have and FridgeRaider will only suggest dishes you can cook right now. No shopping needed.'),
        h(
          'div',
          { class: 'how' },
          h('div', {}, h('b', {}, '1. Add what you have'), 'Type or paste a list. Leftovers count.'),
          h('div', {}, h('b', {}, '2. Flag what’s fading'), 'Mark things to use soon and they get priority.'),
          h('div', {}, h('b', {}, '3. Cook'), 'Each recipe adapts to your exact ingredients.'),
        ),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => $('#sample-btn').click() }, 'Try a sample fridge'),
      ),
    );
    $('#almost-wrap').hidden = true;
    updateJump(0);
    return;
  }

  summary.textContent = ready.length
    ? `${ready.length} dish${ready.length === 1 ? '' : 'es'} you can make right now with what you have.`
    : 'Nothing complete yet. Add a few more things, or check the near misses below.';

  grid.replaceChildren(...ready.map((plan, i) => readyCard(plan, i === 0)));
  if (!ready.length) {
    grid.append(
      h('div', { class: 'empty-state' }, h('div', { class: 'big', 'aria-hidden': 'true' }, '🤔'), h('h3', {}, 'Almost there'),
        h('p', {}, 'Staples like eggs, rice, pasta, bread, tortillas, canned beans or tomatoes unlock lots of dishes. Try loosening the filters too.')),
    );
  }

  $('#almost-wrap').hidden = !almost.length;
  $('#almost-grid').replaceChildren(...almost.slice(0, 6).map(almostCard));
  updateJump(ready.length);
}

function readyCard(plan, top) {
  const r = plan.recipe;
  const shown = plan.usedItems.filter((i) => !i.tags.has('staple'));
  const soon = plan.usedItems.filter((i) => i.useSoon);
  const names = shown.slice(0, 5).map(nameOf);
  const extra = shown.length - names.length;
  return h(
    'button',
    { type: 'button', class: `card${top ? ' top-pick' : ''}`, onclick: () => openRecipe(r.id) },
    h(
      'div',
      { class: 'card-top' },
      h('span', { class: 'card-emoji', 'aria-hidden': 'true' }, r.emoji),
      h('div', {}, h('h3', {}, r.name), h('div', { class: 'card-meta' }, recipeMeta(r))),
    ),
    h('p', { class: 'card-uses' }, 'Uses ', h('strong', {}, names.join(', ')), extra > 0 ? ` +${extra} more` : ''),
    h(
      'div',
      { class: 'badges' },
      top ? h('span', { class: 'badge top' }, 'Best match') : null,
      soon.length ? h('span', { class: 'badge soon' }, `⏰ Uses up ${soon.map(nameOf).join(', ')}`) : null,
      h('span', { class: 'badge' }, `${shown.length} of your ingredients`),
    ),
  );
}

function almostCard(plan) {
  const r = plan.recipe;
  const miss = plan.missing[0];
  const label = miss.needsAny ? miss.needsAny.map((s) => s.label.toLowerCase()).join(' or ') : miss.slot.label.toLowerCase();
  const opts = suggestionsFor(miss, { diet: state.filters.diet, limit: 5 });
  return h(
    'div',
    { class: 'card almost-card' },
    h(
      'div',
      { class: 'card-top' },
      h('span', { class: 'card-emoji', 'aria-hidden': 'true' }, r.emoji),
      h('div', {}, h('h3', {}, r.name), h('div', { class: 'card-meta' }, recipeMeta(r))),
    ),
    h('p', { class: 'need' }, 'Needs ', h('strong', {}, label), '. Do you have any of these?'),
    h(
      'div',
      { class: 'have-row' },
      opts.map((ing) =>
        h('button', { type: 'button', onclick: () => { addItems([{ id: ing.id }]); toast(`Added ${ing.name}`); } }, `I have ${ing.name.toLowerCase()}`),
      ),
    ),
  );
}

// On narrow screens, offer a shortcut from the kitchen panel down to the results.
let resultsVisible = false;
let readyCount = 0;
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    resultsVisible = entry.isIntersecting;
    updateJump(readyCount);
  }).observe($('#results'));
}
function updateJump(count) {
  readyCount = count;
  const btn = $('#jump-btn');
  const narrow = window.matchMedia('(max-width: 860px)').matches;
  btn.hidden = !(narrow && count > 0 && !resultsVisible);
  btn.textContent = `🍽️ ${count} recipe${count === 1 ? '' : 's'} ready ↓`;
}

/* ------------------------------------------------------------------ */
/* Recipe dialog                                                       */
/* ------------------------------------------------------------------ */

const dialog = $('#recipe-dialog');
let current = null; // { recipeId, seed, plan }

function openRecipe(recipeId, seed = state.seed) {
  const r = RECIPES.find((x) => x.id === recipeId);
  if (!r) return;
  const plan = planRecipe(r, kitchen(), { diet: state.filters.diet, seed });
  current = { recipeId, seed, plan, nextSeed: nextVariantSeed(plan, seed) };

  $('#dlg-emoji').textContent = r.emoji;
  $('#dlg-title').textContent = r.name;
  $('#dlg-meta').textContent = recipeMeta(r);
  $('#dlg-blurb').textContent = r.blurb;

  $('#dlg-uses').replaceChildren(
    ...r.slots
      .filter((s) => plan.fills[s.key].length)
      .map((s) => {
        const items = plan.fills[s.key];
        return h(
          'li',
          {},
          h('span', { class: 'slot-label' }, s.label),
          items.map((it, i) => [i ? ', ' : '', it.useSoon ? h('span', { class: 'soon-dot', title: 'Use soon' }, '⏰ ') : null, nameOf(it)]),
          s.amount ? h('span', { class: 'amt' }, ` — ${s.amount}`) : null,
        );
      }),
  );
  $('#dlg-steps').replaceChildren(...renderSteps(plan).map((t) => h('li', {}, h('span', {}, t))));
  $('#dlg-tip').textContent = r.tip || '';
  $('#dlg-tip').hidden = !r.tip;

  // Only offer "different combo" if there's actually something to vary.
  $('#dlg-remix').hidden = current.nextSeed == null;

  $('#cooked-panel').hidden = true;
  $('#dlg-foot').hidden = false;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('article').scrollTop = 0;
}

$('#dlg-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // backdrop click
});

const fillSignature = (plan) => JSON.stringify(plan.recipe.slots.map((s) => plan.fills[s.key].map((i) => i.id).sort()));

/** The next seed (within a small window) that produces a different ingredient combo, or null. */
function nextVariantSeed(plan, seed) {
  const sig = fillSignature(plan);
  for (let s = seed + 1; s <= seed + 30; s++) {
    if (fillSignature(planRecipe(plan.recipe, kitchen(), { diet: state.filters.diet, seed: s })) !== sig) return s;
  }
  return null;
}

$('#dlg-remix').addEventListener('click', () => {
  if (current?.nextSeed != null) openRecipe(current.recipeId, current.nextSeed);
});

$('#dlg-print').addEventListener('click', () => window.print());

$('#dlg-cooked').addEventListener('click', () => {
  if (!current) return;
  const items = current.plan.usedItems.filter((i) => !i.tags.has('staple'));
  $('#cooked-list').replaceChildren(
    ...items.map((it) =>
      h('label', {}, h('input', { type: 'checkbox', value: it.id, checked: true }), nameOf(it)),
    ),
  );
  $('#cooked-panel').hidden = false;
  $('#dlg-foot').hidden = true;
  $('#cooked-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#cooked-cancel').addEventListener('click', () => {
  $('#cooked-panel').hidden = true;
  $('#dlg-foot').hidden = false;
});

$('#cooked-confirm').addEventListener('click', () => {
  const remove = new Set([...document.querySelectorAll('#cooked-list input:checked')].map((el) => el.value));
  const before = state.pantry;
  state.pantry = state.pantry.filter((p) => !remove.has(p.id));
  save();
  dialog.close();
  render();
  toast(remove.size ? `Enjoy! Removed ${remove.size} used-up item${remove.size > 1 ? 's' : ''}.` : 'Enjoy your meal!',
    remove.size ? { label: 'Undo', run: () => { state.pantry = before; save(); render(); } } : null);
});

/* ------------------------------------------------------------------ */

function render() {
  syncFilters();
  renderPantry();
  renderResults();
}

window.matchMedia('(max-width: 860px)').addEventListener?.('change', () => updateJump(readyCount));
render();
