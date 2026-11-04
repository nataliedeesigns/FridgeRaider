# 🧊 FridgeRaider

**Cook something tasty with what's already in your kitchen, with no shopping trip.**

Tell FridgeRaider what's in your fridge and pantry. It only suggests dishes you can make
*right now* from exactly those ingredients, and writes the method around them.

## How it works

Most recipe apps start from a fixed recipe and give you a shopping list. FridgeRaider
works the other way round. Its recipes are **flexible templates** (fried rice, frittata,
fridge-clearing pasta, stir-fry, soup, quesadillas, curry, crumble…) built from *slots*:

```
Kitchen-Sink Fried Rice
  rice        (required)  cooked rice or uncooked rice
  fat         (required)  any oil or butter
  egg         (optional)
  aromatics   (optional)  up to 3 of garlic / ginger / onion / …
  protein     (optional)  up to 2 of anything tagged #protein
  vegetables  (optional)  up to 4 of anything tagged #veg (not salad-only veg)
  seasoning   (optional)  soy / oyster / fish sauce / kimchi / hot sauce
  needs at least one of: egg, protein, vegetables
```

The engine fills each slot from your kitchen, then renders steps that mention your actual
ingredients ("Add spinach, peas and carrots and stir-fry 3–4 minutes…"). Steps that
don't apply (no egg? no scramble step) are dropped. One template turns into hundreds
of different dishes.

## Features

- **Type or paste anything.** "eggs, half an onion, leftover rice and 2 carrots"
  understands quantities, plurals, synonyms (courgette → zucchini, garbanzo → chickpeas)
  and leftovers (leftover rice → cooked rice). Autocomplete covers ~160 ingredients and
  their synonyms. Unrecognised items can be added by picking what kind of thing they are.
- **Ready to cook, nothing to buy.** Results only show recipes your kitchen can fully cover.
- **⏰ Use it up.** Flag ingredients that are about to go off, and recipes that use them
  rank first and are badged.
- **One thing away.** Near misses ask "do you have any of these?" with one-tap add,
  which is good for jogging your memory about the back of the cupboard.
- **Remix.** Get a different ingredient combination for the same dish, or for all dishes.
- **Filters:** meal type, vegetarian / vegan (hidden animal products like fish sauce
  are excluded too), and max cooking time.
- **"I cooked this"** removes the ingredients you used up, so your kitchen stays accurate.
- Remembers your kitchen in the browser (localStorage), works on mobile, supports dark mode,
  and can print a single recipe.

## Running it

No build step and no dependencies. Node 18+ is only needed for the dev server and tests.

```bash
npm start        # serves http://localhost:8080 (set PORT to change)
npm test         # engine + data-integrity tests (node:test)
```

Any static file server works too (e.g. `python3 -m http.server`). The app uses ES modules,
so it has to be served rather than opened via `file://`.

## Project layout

```
index.html              App shell
src/app.js              UI controller (DOM, state, persistence)
src/engine.js           Pure matching/planning/rendering engine (browser + Node)
src/data/ingredients.js Ingredient catalog: names, categories, tags, synonyms
src/data/recipes.js     Flexible recipe templates
src/styles.css          Styles (light + dark)
scripts/serve.js        Zero-dependency static dev server
test/engine.test.js     Tests
```

## Adding a recipe

Add an entry to `src/data/recipes.js`. Each slot lists what it `accepts` (ingredient ids or
`#tags`), with `min`/`max` counts. Steps use a small template syntax:

| Syntax | Meaning |
| --- | --- |
| `{veg}` | the chosen ingredients, e.g. "carrots, peas and onion" |
| `{veg+protein}` | combined list from several slots |
| `{fruit=apple/pear}` | only the chosen items with those ids |
| `?veg: …` / `!veg: …` | whole step only if the slot is filled / empty |
| `{?veg:…}` / `{!veg:…}` | inline conditional text (nestable) |
| `?a\|b`, `?carb=rice` | any slot filled; slot contains a given id |

`npm test` checks that every slot, tag and template reference points to something real,
and renders every recipe against several kitchens to catch broken output.
