import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  INGREDIENTS,
  RECIPES,
  STAPLE_IDS,
  buildKitchen,
  findRecipes,
  matchIngredient,
  parseIngredientText,
  planRecipe,
  renderSteps,
  renderText,
  searchIngredients,
  suggestionsFor,
} from '../src/engine.js';

const kitchenOf = (...ids) => buildKitchen([...STAPLE_IDS, ...ids].map((id) => ({ id })));
const recipe = (id) => RECIPES.find((r) => r.id === id);

/* ---------------- data integrity ---------------- */

test('ingredient ids are unique', () => {
  const ids = INGREDIENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every recipe slot references real ingredients or tags', () => {
  const allTags = new Set(INGREDIENTS.flatMap((i) => i.tags));
  for (const r of RECIPES) {
    for (const slot of r.slots) {
      assert.ok(slot.min <= slot.max, `${r.id}.${slot.key} min>max`);
      for (const rule of [...slot.accepts, ...slot.exclude]) {
        if (rule.startsWith('#')) assert.ok(allTags.has(rule.slice(1)), `${r.id}.${slot.key}: unknown tag ${rule}`);
        else assert.ok(CATALOG.has(rule), `${r.id}.${slot.key}: unknown ingredient ${rule}`);
      }
    }
  }
});

test('every template reference points at a real slot', () => {
  for (const r of RECIPES) {
    const keys = new Set(r.slots.map((s) => s.key));
    for (const k of r.needsAny || []) assert.ok(keys.has(k), `${r.id}: needsAny ${k}`);
    for (const step of r.steps) {
      const refs = [...step.matchAll(/[{?!]([a-z]+(?:[+|][a-z]+)*)(?:=([\w/-]+))?[}:]/g)];
      for (const [, group, ids] of refs) {
        for (const key of group.split(/[+|]/)) assert.ok(keys.has(key), `${r.id}: unknown slot "${key}" in "${step}"`);
        for (const id of ids ? ids.split('/') : []) assert.ok(CATALOG.has(id), `${r.id}: unknown id "${id}"`);
      }
    }
  }
});

test('recipe ids are unique', () => {
  assert.equal(new Set(RECIPES.map((r) => r.id)).size, RECIPES.length);
});

/* ---------------- parsing ---------------- */

test('matchIngredient handles plurals, synonyms and quantities', () => {
  assert.equal(matchIngredient('Eggs'), 'egg');
  assert.equal(matchIngredient('2 ripe tomatoes'), 'tomato');
  assert.equal(matchIngredient('half an onion'), 'onion');
  assert.equal(matchIngredient('a bag of frozen peas'), 'peas');
  assert.equal(matchIngredient('courgettes'), 'zucchini');
  assert.equal(matchIngredient('leftover rice'), 'cooked-rice');
  assert.equal(matchIngredient('rotisserie chicken'), 'cooked-chicken');
  assert.equal(matchIngredient('chicken thighs'), 'chicken');
  assert.equal(matchIngredient('1 can chickpeas'), 'chickpeas');
  assert.equal(matchIngredient('spaghetti'), 'pasta');
  assert.equal(matchIngredient('jalapeño'), 'jalapeno');
  assert.equal(matchIngredient('blueberries'), 'berries');
  assert.equal(matchIngredient('soy sauce'), 'soy-sauce');
  assert.equal(matchIngredient('sweet potatoes'), 'sweet-potato');
  assert.equal(matchIngredient('dragonfruit kombucha'), null);
});

test('parseIngredientText splits lists and reports unknowns', () => {
  const { matched, unknown } = parseIngredientText('eggs, 2 carrots and some spinach\nleftover rice; zorblax');
  assert.deepEqual(matched.map((m) => m.id), ['egg', 'carrot', 'spinach', 'cooked-rice']);
  assert.deepEqual(unknown, ['zorblax']);
});

test('searchIngredients finds by synonym prefix', () => {
  const ids = searchIngredients('cour').map((r) => r.ing.id);
  assert.ok(ids.includes('zucchini'));
  assert.equal(searchIngredients('egg')[0].ing.id, 'egg');
});

/* ---------------- planning ---------------- */

test('fried rice is makeable from rice + egg + veg and uses them', () => {
  const plan = planRecipe(recipe('fried-rice'), kitchenOf('cooked-rice', 'egg', 'carrot', 'peas', 'soy-sauce'));
  assert.ok(plan.ok);
  assert.deepEqual(plan.fills.rice.map((i) => i.id), ['cooked-rice']);
  assert.deepEqual(plan.fills.egg.map((i) => i.id), ['egg']);
  assert.deepEqual(plan.fills.veg.map((i) => i.id).sort(), ['carrot', 'peas']);
  assert.deepEqual(plan.fills.sauce.map((i) => i.id), ['soy-sauce']);
});

test('needsAny blocks a recipe that would be just plain rice', () => {
  const plan = planRecipe(recipe('fried-rice'), kitchenOf('cooked-rice'));
  assert.equal(plan.ok, false);
  assert.ok(plan.missing[0].needsAny);
});

test('missing required slot is reported', () => {
  const plan = planRecipe(recipe('frittata'), kitchenOf('spinach', 'feta'));
  assert.equal(plan.ok, false);
  assert.equal(plan.missing[0].slot.key, 'egg');
});

test('an ingredient is never used in two slots', () => {
  const plan = planRecipe(recipe('fried-rice'), kitchenOf('cooked-rice', 'scallion', 'egg'));
  const ids = plan.usedItems.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('scarce items go to the slot that requires them', () => {
  // Butter could be fat for the frittata, but oil is also there; both fine.
  // Here: only ingredient that fits "fat" is butter -> must be used as fat.
  const kitchen = buildKitchen([{ id: 'egg' }, { id: 'butter' }, { id: 'spinach' }]);
  const plan = planRecipe(recipe('frittata'), kitchen);
  assert.ok(plan.ok);
  assert.deepEqual(plan.fills.fat.map((i) => i.id), ['butter']);
});

test('vegetarian and vegan diets exclude ineligible items', () => {
  const kitchen = kitchenOf('cooked-rice', 'egg', 'bacon', 'carrot', 'fish-sauce');
  const veggie = planRecipe(recipe('fried-rice'), kitchen, { diet: 'vegetarian' });
  assert.ok(!veggie.usedItems.some((i) => i.id === 'bacon' || i.id === 'fish-sauce'));
  assert.ok(veggie.usedItems.some((i) => i.id === 'egg'));
  const vegan = planRecipe(recipe('fried-rice'), kitchen, { diet: 'vegan' });
  assert.ok(!vegan.usedItems.some((i) => i.id === 'egg'));
  assert.ok(vegan.ok); // carrot still qualifies
});

test('use-soon items are preferred and boost the score', () => {
  const base = [...STAPLE_IDS, 'cooked-rice', 'carrot', 'peas', 'corn', 'broccoli', 'bell-pepper', 'zucchini'].map((id) => ({ id }));
  const normal = planRecipe(recipe('fried-rice'), buildKitchen(base));
  const urgent = buildKitchen(base.map((e) => (e.id === 'zucchini' ? { ...e, useSoon: true } : e)));
  const plan = planRecipe(recipe('fried-rice'), urgent);
  assert.ok(plan.fills.veg.some((i) => i.id === 'zucchini'));
  assert.ok(plan.score > normal.score);
});

test('findRecipes only returns recipes needing nothing extra, plus near misses', () => {
  const kitchen = kitchenOf('egg', 'bread', 'butter', 'milk', 'cheddar');
  const { ready, almost } = findRecipes(kitchen);
  const ids = ready.map((p) => p.recipe.id);
  for (const want of ['french-toast', 'grilled-cheese', 'scrambled-eggs', 'frittata']) assert.ok(ids.includes(want), want);
  for (const p of ready) assert.ok(p.ok);
  for (const p of almost) assert.equal(p.ok, false);
  assert.ok(!ids.includes('fried-rice'));
});

test('filters by meal and time', () => {
  const kitchen = kitchenOf('egg', 'bread', 'butter', 'milk', 'cheddar', 'flour', 'sugar', 'baking-powder');
  const { ready } = findRecipes(kitchen, { meal: 'breakfast', maxMinutes: 15 });
  assert.ok(ready.length > 0);
  for (const p of ready) {
    assert.ok(p.recipe.meals.includes('breakfast'));
    assert.ok(p.recipe.minutes <= 15);
  }
});

test('seeded remix is deterministic', () => {
  const kitchen = kitchenOf('cooked-rice', 'carrot', 'peas', 'corn', 'broccoli', 'bell-pepper', 'zucchini', 'mushroom');
  const a = planRecipe(recipe('fried-rice'), kitchen, { seed: 7 });
  const b = planRecipe(recipe('fried-rice'), kitchen, { seed: 7 });
  assert.deepEqual(a.fills.veg.map((i) => i.id), b.fills.veg.map((i) => i.id));
});

test('suggestionsFor lists things that would fill the gap', () => {
  const plan = planRecipe(recipe('stir-fry'), kitchenOf('broccoli', 'carrot'));
  assert.equal(plan.ok, false);
  const ids = suggestionsFor(plan.missing[0]).map((i) => i.id);
  assert.ok(ids.includes('soy-sauce'));
});

/* ---------------- rendering ---------------- */

test('renderText handles slots, joins, nesting and id conditions', () => {
  const egg = { id: 'egg', name: 'Eggs' };
  const fills = {
    a: [{ id: 'carrot', name: 'Carrots' }, { id: 'peas', name: 'Peas' }, { id: 'corn', name: 'Corn' }],
    b: [egg],
    c: [],
  };
  assert.equal(renderText('Add {a}.', fills), 'Add carrots, peas and corn.');
  assert.equal(renderText('X{?c: never}{!c: shown}', fills), 'X shown');
  assert.equal(renderText('{?b:with {b}{?c: and {c}}}', fills), 'with eggs');
  assert.equal(renderText('{?b=egg:yes}{?b=bread/milk:no}', fills), 'yes');
  assert.equal(renderText('{b+a}', fills), 'eggs, carrots, peas and corn');
});

test('every ready recipe renders clean steps for a well-stocked kitchen', () => {
  const kitchen = buildKitchen(INGREDIENTS.map((i) => ({ id: i.id })));
  const sparse = kitchenOf('egg', 'bread', 'cooked-rice', 'pasta', 'tortilla', 'potato', 'flour', 'oats', 'banana', 'milk',
    'cheddar', 'chickpeas', 'canned-tomatoes', 'onion', 'carrot', 'cabbage', 'lemon', 'curry-powder', 'yogurt', 'instant-ramen',
    'tortilla-chips', 'tuna', 'mayo', 'avocado', 'peanut-butter', 'soy-sauce', 'apple', 'sugar', 'butter', 'baking-powder', 'chili-powder');
  for (const k of [kitchen, sparse]) {
    for (const r of RECIPES) {
      for (const seed of [0, 1, 2, 3]) {
        const plan = planRecipe(r, k, { seed });
        if (!plan.ok) continue;
        const steps = renderSteps(plan);
        assert.ok(steps.length >= 2, `${r.id} has too few steps`);
        for (const s of steps) {
          assert.ok(!/[{}]/.test(s), `${r.id}: unrendered braces: ${s}`);
          assert.ok(!/\b(undefined|null)\b/.test(s), `${r.id}: ${s}`);
          assert.ok(!/\s[,.]|,,|\band and\b|\bwith with\b|\bwith\s*[,.]/.test(s), `${r.id}: awkward text: ${s}`);
        }
      }
    }
  }
});
