// FridgeRaider matching engine — pure functions, no DOM. Runs in browser and Node.

import { INGREDIENTS, STAPLE_IDS } from './data/ingredients.js';
import { RECIPES } from './data/recipes.js';

export { INGREDIENTS, RECIPES, STAPLE_IDS };

/* ------------------------------------------------------------------ */
/* Catalog & text helpers                                              */
/* ------------------------------------------------------------------ */

export const CATALOG = new Map(INGREDIENTS.map((i) => [i.id, i]));

function singular(word) {
  if (word.length <= 3) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
  if (/oes$/.test(word)) return word.slice(0, -2);
  if (/(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word) && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Lowercase, strip accents/punctuation, singularise each word. */
export function normalizeKey(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%' -]/g, ' ')
    .replace(/'/g, '')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

const LOOKUP = new Map();
for (const ing of INGREDIENTS) {
  // Synonyms first so canonical names win any collision.
  for (const syn of ing.synonyms) {
    const k = normalizeKey(syn);
    if (!LOOKUP.has(k)) LOOKUP.set(k, ing.id);
  }
}
for (const ing of INGREDIENTS) {
  LOOKUP.set(normalizeKey(ing.name), ing.id);
  LOOKUP.set(normalizeKey(ing.id), ing.id);
}

// Words that describe quantity/state rather than the ingredient itself.
const FILLER = new Set(
  (
    'a an the some few couple of half quarter whole bit little lot lots leftover leftovers ' +
    'old fresh ripe overripe large small medium big tiny bag bags box boxes jar jars can cans tin tins ' +
    'pack packet packets bunch bunches handful handfuls cup cups tbsp tsp tablespoon teaspoon ' +
    'g kg gram grams lb lbs pound pounds oz ounce ounces ml l liter litre piece pieces slice slices ' +
    'head heads clove stalk stalks sprig sprigs block bottle carton dozen loaf about approx ' +
    'chopped diced sliced organic raw frozen canned tinned dried store bought homemade cold my and or'
  )
    .split(' ')
    .map(singular),
);

/**
 * Resolve one free-text item ("2 ripe tomatoes", "leftover rice") to a catalog id.
 * Returns null when nothing matches.
 */
export function matchIngredient(text) {
  const key = normalizeKey(text.replace(/\(.*?\)/g, ' ')).replace(/\b\d+([./]\d+)?\b/g, ' ').trim();
  if (!key) return null;
  if (LOOKUP.has(key)) return LOOKUP.get(key);

  let words = key.split(' ').filter(Boolean);
  const meaningful = words.filter((w) => !FILLER.has(w));
  // Try with filler words removed (keeps "frozen peas" etc. working via the full-key check above).
  if (meaningful.length && LOOKUP.has(meaningful.join(' '))) return LOOKUP.get(meaningful.join(' '));
  // Special-case: "leftover/cooked rice" means cooked rice.
  if (/\brice\b/.test(key) && /\b(leftover|cooked|day old|cold)\b/.test(key)) return 'cooked-rice';
  if (/\bchicken\b/.test(key) && /\b(leftover|cooked|roast|rotisserie|grilled|shredded)\b/.test(key)) return 'cooked-chicken';

  words = meaningful.length ? meaningful : words;
  // Longest contiguous sub-phrase that matches.
  for (let len = words.length - 1; len >= 1; len--) {
    for (let start = words.length - len; start >= 0; start--) {
      const phrase = words.slice(start, start + len).join(' ');
      if (LOOKUP.has(phrase)) return LOOKUP.get(phrase);
    }
  }
  return null;
}

/**
 * If the user typed a specific synonym ("spaghetti", "almond butter"), keep it as a
 * display label so recipes talk about *their* ingredient. Returns null otherwise.
 */
export function labelFor(text, id) {
  const ing = CATALOG.get(id);
  if (!ing) return null;
  const key = normalizeKey(text);
  if (key === normalizeKey(ing.name) || key === normalizeKey(ing.id)) return null;
  const syn = ing.synonyms.find((s) => normalizeKey(s) === key);
  // Plural/generic synonyms ("eggs", "cheese") add nothing over the canonical name.
  if (!syn || normalizeKey(syn) === normalizeKey(ing.name.split(' / ')[0])) return null;
  return syn;
}

/** Split a pasted list ("eggs, half an onion and 2 carrots") into matched ids + unknown strings. */
export function parseIngredientText(text) {
  const pieces = text
    .split(/[,;\n•·]+|\s+and\s+|\s+&\s+|\s+\+\s+/i)
    .map((p) => p.replace(/^[\s*\-–—\d.)]+/, '').trim())
    .filter(Boolean);
  const matched = [];
  const unknown = [];
  for (const piece of pieces) {
    const id = matchIngredient(piece);
    if (id) {
      if (!matched.some((m) => m.id === id)) matched.push({ id, text: piece, label: labelFor(piece, id) });
    } else if (!unknown.includes(piece)) {
      unknown.push(piece);
    }
  }
  return { matched, unknown };
}

/** Autocomplete: catalog entries whose name or synonym contains the query. */
export function searchIngredients(query, { exclude = new Set(), limit = 8 } = {}) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const ing of INGREDIENTS) {
    if (exclude.has(ing.id)) continue;
    const names = [ing.name, ...ing.synonyms].map((n) => n.toLowerCase());
    let best = Infinity;
    let via = null;
    names.forEach((n, idx) => {
      let rank;
      if (n === q) rank = 0;
      else if (n.startsWith(q)) rank = 1;
      else if (n.split(/[\s/-]+/).some((w) => w.startsWith(q))) rank = 2;
      else if (n.includes(q)) rank = 3;
      else return;
      rank += idx === 0 ? 0 : 0.5; // prefer canonical name
      if (rank < best) {
        best = rank;
        via = idx === 0 ? null : names[idx];
      }
    });
    if (best < Infinity) results.push({ ing, rank: best, via });
  }
  results.sort((a, b) => a.rank - b.rank || a.ing.name.length - b.ing.name.length);
  return results.slice(0, limit);
}

/** The name used inside recipe steps: "Cheddar / melty cheese" -> "cheddar". */
export function textName(ing, label) {
  const base = (label || ing.name).replace(/\s*\(.*?\)\s*/g, ' ').split(' / ')[0].trim();
  return base
    .split(' ')
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(' ');
}

export function joinList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

/* ------------------------------------------------------------------ */
/* Kitchen model                                                       */
/* ------------------------------------------------------------------ */

/**
 * Build the lookup the planner needs from the persisted pantry.
 * pantry: [{ id, useSoon?, label? }]; custom: { [id]: {id,name,category,tags} }
 */
export function buildKitchen(pantry, custom = {}) {
  const items = [];
  for (const entry of pantry) {
    const ing = CATALOG.get(entry.id) || custom[entry.id];
    if (!ing) continue;
    items.push({ ...ing, tags: new Set(ing.tags), useSoon: !!entry.useSoon, label: entry.label || null });
  }
  return items;
}

function accepts(item, rule) {
  return rule.startsWith('#') ? item.tags.has(rule.slice(1)) : item.id === rule;
}

function acceptIndex(item, slot) {
  const idx = slot.accepts.findIndex((r) => accepts(item, r));
  if (idx === -1) return -1;
  if (slot.exclude.some((r) => accepts(item, r))) return -1;
  return idx;
}

export function dietAllows(item, diet) {
  if (diet === 'vegetarian' || diet === 'vegan') {
    if (item.tags.has('meat') || item.tags.has('fish') || item.tags.has('notveg')) return false;
  }
  if (diet === 'vegan' && item.tags.has('animal')) return false;
  return true;
}

// Small deterministic PRNG so "Remix" gives repeatable variety.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Planner                                                             */
/* ------------------------------------------------------------------ */

/**
 * Try to make `recipe` from `kitchen`. Returns:
 * { recipe, ok, fills: {slotKey: item[]}, missing: [{slot}|{needsAny}], usedCount, useSoonCount, score }
 */
export function planRecipe(recipe, kitchen, { diet = 'any', seed = 0 } = {}) {
  const rand = seed ? mulberry32(seed ^ hashString(recipe.id)) : null;
  const available = kitchen.filter((item) => dietAllows(item, diet));

  // Candidates per slot, with a sort key (lower = better).
  const cands = {};
  for (const slot of recipe.slots) {
    cands[slot.key] = available
      .map((item) => ({ item, idx: acceptIndex(item, slot) }))
      .filter((c) => c.idx >= 0);
  }
  // How many slots compete for each item — scarce items go to the slot that needs them.
  const demand = new Map();
  for (const list of Object.values(cands)) {
    for (const { item } of list) demand.set(item.id, (demand.get(item.id) || 0) + 1);
  }
  const jitter = new Map(available.map((i) => [i.id, rand ? rand() * 3 : 0]));
  const rank = (c) =>
    (c.item.useSoon ? -100 : 0) + c.idx + jitter.get(c.item.id) + (demand.get(c.item.id) - 1) * 0.4;

  const used = new Set();
  const fills = Object.fromEntries(recipe.slots.map((s) => [s.key, []]));
  const take = (slot, n) => {
    const pool = cands[slot.key]
      .filter((c) => !used.has(c.item.id))
      .sort((a, b) => rank(a) - rank(b) || a.item.name.localeCompare(b.item.name));
    for (const c of pool.slice(0, n)) {
      fills[slot.key].push(c.item);
      used.add(c.item.id);
    }
  };

  // Phase 1: satisfy required minimums, most constrained slot first.
  const required = recipe.slots
    .filter((s) => s.min > 0)
    .sort((a, b) => cands[a.key].length - cands[b.key].length);
  for (const slot of required) take(slot, slot.min);

  const missing = [];
  for (const slot of recipe.slots) {
    if (fills[slot.key].length < slot.min) missing.push({ slot, have: fills[slot.key].length });
  }

  // Phase 2: fill optional capacity in recipe order.
  for (const slot of recipe.slots) take(slot, slot.max - fills[slot.key].length);

  if (recipe.needsAny && !recipe.needsAny.some((k) => fills[k].length)) {
    missing.push({ needsAny: recipe.needsAny.map((k) => recipe.slots.find((s) => s.key === k)) });
  }

  const usedItems = Object.values(fills).flat();
  const nonStaple = usedItems.filter((i) => !i.tags.has('staple'));
  const useSoonCount = usedItems.filter((i) => i.useSoon).length;
  const optionalSlots = recipe.slots.filter((s) => s.min === 0);
  const optionalFilled = optionalSlots.filter((s) => fills[s.key].length).length;
  const fillRatio = optionalSlots.length ? optionalFilled / optionalSlots.length : 1;

  const score =
    nonStaple.length * 3 + useSoonCount * 10 + fillRatio * 6 - recipe.minutes / 15 + (rand ? rand() * 2 : 0);

  return {
    recipe,
    ok: missing.length === 0,
    fills,
    missing,
    usedItems,
    usedCount: nonStaple.length,
    useSoonCount,
    score,
  };
}

/**
 * Rank every recipe against the kitchen.
 * Returns { ready: plan[], almost: plan[] } — "almost" are one ingredient short.
 */
export function findRecipes(kitchen, { diet = 'any', meal = 'any', maxMinutes = 0, seed = 0 } = {}) {
  const ready = [];
  const almost = [];
  for (const recipe of RECIPES) {
    if (meal !== 'any' && !recipe.meals.includes(meal)) continue;
    if (maxMinutes && recipe.minutes > maxMinutes) continue;
    const plan = planRecipe(recipe, kitchen, { diet, seed });
    if (plan.ok) ready.push(plan);
    else if (plan.missing.length === 1 && missingCount(plan.missing[0]) === 1) almost.push(plan);
  }
  ready.sort((a, b) => b.score - a.score);
  almost.sort((a, b) => b.score - a.score);
  return { ready, almost };
}

function missingCount(m) {
  return m.needsAny ? 1 : m.slot.min - m.have;
}

/** Ingredient ids that would satisfy a missing requirement (for "Do you have…?" prompts). */
export function suggestionsFor(missing, { diet = 'any', limit = 5 } = {}) {
  const slots = missing.needsAny || [missing.slot];
  const out = [];
  for (const slot of slots) {
    for (const rule of slot.accepts) {
      const ids = rule.startsWith('#')
        ? INGREDIENTS.filter((i) => i.tags.includes(rule.slice(1))).map((i) => i.id)
        : [rule];
      for (const id of ids) {
        const ing = CATALOG.get(id);
        if (!ing || out.includes(ing)) continue;
        const asItem = { ...ing, tags: new Set(ing.tags) };
        if (acceptIndex(asItem, slot) < 0 || !dietAllows(asItem, diet)) continue;
        out.push(ing);
      }
    }
  }
  return out.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Template rendering                                                  */
/* ------------------------------------------------------------------ */

function evalCondition(expr, fills) {
  return expr.split('|').some((part) => {
    const [key, idList] = part.split('=');
    const items = fills[key.trim()] || [];
    if (!idList) return items.length > 0;
    const ids = idList.split('/').map((s) => s.trim());
    return items.some((i) => ids.includes(i.id));
  });
}

// "{veg}", "{veg+protein}" (combined list) or "{fruit=apple/pear}" (only those ids).
function slotText(ref, fills) {
  const items = ref.split('+').flatMap((part) => {
    const [key, idList] = part.split('=');
    const list = fills[key.trim()] || [];
    return idList ? list.filter((i) => idList.split('/').includes(i.id)) : list;
  });
  return joinList(items.map((i) => textName(i, i.label)));
}

/** Render a template string. Supports nesting: {?a:text {b} {?c:more}}. */
export function renderText(template, fills) {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    // Find the matching close brace.
    let depth = 0;
    let j = i;
    for (; j < template.length; j++) {
      if (template[j] === '{') depth++;
      else if (template[j] === '}' && --depth === 0) break;
    }
    const inner = template.slice(i + 1, j);
    if (inner[0] === '?' || inner[0] === '!') {
      const colon = inner.indexOf(':');
      const cond = evalCondition(inner.slice(1, colon), fills);
      if (inner[0] === '?' ? cond : !cond) out += renderText(inner.slice(colon + 1), fills);
    } else {
      out += slotText(inner, fills);
    }
    i = j + 1;
  }
  return out;
}

/** Render all steps of a plan, dropping steps whose leading condition fails. */
export function renderSteps(plan) {
  const steps = [];
  for (const raw of plan.recipe.steps) {
    const m = raw.match(/^([?!])([\w|=/+-]+):\s*/);
    if (m) {
      const cond = evalCondition(m[2], plan.fills);
      if (m[1] === '?' ? !cond : cond) continue;
    }
    const text = renderText(m ? raw.slice(m[0].length) : raw, plan.fills)
      .replace(/\s+([,.])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    steps.push(text.charAt(0).toUpperCase() + text.slice(1));
  }
  return steps;
}
