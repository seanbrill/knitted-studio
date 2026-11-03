> **Superseded rules (2026-11-03).** The colour roles changed after the first
> iteration shipped as a dark slab. **Red and orange are the primary colours;
> white and black are secondary.** The app defaults to Day (a light, warm
> workspace with a warm black tool rail), and Night is an option. This retires
> three rules below: "the work glows, the tool recedes", "if a screen has more
> than one orange area outside the canvas, remove one", and "Night is the
> default theme for the app". They are replaced by: one primary button per
> view, one brand colour field per screen, everything else neutral. Tokens in
> `packages/ui/src/globals.css` are already updated and are the source of truth;
> this document is rewritten in full in Phase 1, pending the owner's approval.
> Unchanged: the vocabulary, type, the stitch outline, motifs, voice, motion.

knitted is an open-source studio where people and their AI models make social posts, ads and web graphics from reusable brand **patterns** (prefabs). The look is **warm heat on black and white**: big color fields of orange and red, heavy white headlines, and a quiet near-black workspace so the work is the brightest thing on screen. Domain: **knitted.studio**.

## Design philosophy

1. **The work glows, the tool recedes.** App chrome lives in `surface`, `surface-raised` and `ink-muted`. `ember` appears only where the user acts: the primary button, the active tool, the selection and the focus ring. If a screen has more than one orange area outside the canvas, remove one.
2. **Monochrome immersion.** Marketing pages and templates commit to one hue per moment: a full-bleed `ember`, `red` or `oxblood` field (or a photo graded into that hue), with type laid directly on it. No rainbow layouts, no more than two brand hues in one frame.
3. **Heavy type, few words.** Headlines are short, huge and tight (`display-xl`, `display`) in Bricolage Grotesque ExtraBold. Supporting copy is small and calm (`body-lg`, `eyebrow`). The contrast in size is the design.
4. **Crafted, not corporate.** One knitting idea runs through everything: the **stitch** (a V-shaped chevron) and the **pattern** (a repeat you set once). Use them as structure and small motifs, never as decorative wallpaper.
5. **Pattern once, knit forever.** Every screen should make it obvious what is locked by the brand pattern and what is free to change.

## Product vocabulary

Use these words in UI copy, docs and the API, consistently:

| Term | Means |
|---|---|
| Pattern | A prefab: a saved, reusable layout with locked brand slots |
| Swatch | A brand kit: colors, fonts, logos and voice for one brand |
| Yarn | Raw assets: photos, logos, video, copy |
| Stitch | A single element in a pattern (text box, image slot, shape) |
| Knit | The verb for producing an output: "Knit 12 posts from this pattern" |

## Color

- Use the four core colors only: **orange** (`ember`), **red** (`red`, with `oxblood` as its deep shade), **black** (`surface` in Night, `ink` in Day) and **white** (`ink` in Night, `surface` in Day). `glow` is a rare amber highlight; `success` and `danger` are states, not brand colors.
- **Night is the default theme for the app.** Day is for docs, the marketing site's light sections and printed or exported guidelines.
- Put `on-ember` (warm black) on `ember`. Never put white on ember: it fails contrast (3.7:1).
- Put `on-red` (white) on `red` and `oxblood`.
- For orange **text**, use `ember-ink`, not `ember`, so it reads in both themes.
- Body text is `ink` on any surface; secondary text is `ink-muted`.
- Selected and hovered items get a `tint` background, with `ember` used only for their outline or indicator.
- **The heat gradient** is the one gradient allowed: `glow` → `ember` → `red`, at 135°. Use it for hero backgrounds, the logo tile and the AI-working shimmer. Never use it behind body text, and never on buttons.
- Photos used on brand surfaces get a **heat grade**: desaturate, then multiply with `ember` or `red` at 60–80%, so a person or product sits inside the color field (as a single-hue duotone).
- Status is never color alone: `success` comes with a check icon and a word, `danger` with an alert icon and a word.

## Typography

All four families are free and open-source on Google Fonts:

- **Bricolage Grotesque**, weights 700 and 800, for everything display (`display-xl`, `display`, `h1`–`h3`). Its slightly irregular, ink-trap shapes give the hand-made feel. Track it tight, as the styles specify, and keep lines to 2–4 words.
- **Geist**, weights 400 and 600, for all UI and reading text (`body-lg`, `body`, `body-sm`, `label`, `button`).
- **Geist Mono**, weights 400 and 500, for `eyebrow` (always UPPERCASE, wide tracking), hex values, pattern IDs and code.
- **Instrument Serif Italic** for `accent`: one word swapped into a display headline ("Make it *knitted*."). Never more than one accent word per screen.

Rules:
- Use sentence case for headlines, buttons and menus. The only uppercase is `eyebrow`.
- Put an `eyebrow` above any marketing headline: a short mono kicker in `ink-muted`, or in `ember-ink` for emphasis.
- Headlines on color fields are `ink` white in Night (on `oxblood`) or `on-ember` black (on `ember`). Never set a headline in orange on red or red on orange.

## Layout and spacing

- Use a 4px base grid: `space-1` through `space-24`.
- **App layout:** a 56px icon rail on the left in `surface`, a 300px inspector in `surface-raised`, the canvas centered in `surface-sunken`, and a 48px top bar holding the file name, the brand swatch chip and the **Knit** button (`ember`).
- **Marketing heroes:** full-bleed color field or heat-graded photo, a glass nav bar (`surface` at 45% opacity, 16px backdrop blur, `radius-lg`, inset `space-4` from the edges), a centered or bottom-left headline with `space-12` insets, and one primary button.
- Keep generous negative space. A hero carries a headline, one line of subcopy and one button. Nothing else.

## Shape, borders and depth

- Radii: `radius-sm` for chips and inputs, `radius-md` for buttons, cards and thumbnails, `radius-lg` for panels and modals, `radius-pill` for badges, toggles and the AI prompt bar.
- Cards are flat: `surface-raised` with a `line` hairline. Only floating things (menus, popovers, the prompt bar) get `shadow-lift`.
- **The stitch outline:** a pattern's locked brand slots are drawn with a 1.5px dashed `ember` border (6px dash, 4px gap). Free, editable stitches use a solid 1px `line-strong` border. That dashed-versus-solid difference is the visual language of the product.
- The focus ring is a solid 2px `ember` outline with a 2px offset, at least 3:1 on every surface in both themes.

## Motifs

- **The stitch chevron.** A V shape drawn with a thick stroke, stacked in columns like a knit swatch. Use it as a divider (a single row of 5–8 Vs), as an empty-state illustration, in the loading state (Vs filling in one by one) and as a pattern on large `ember` fields, drawn in `oxblood`.
- **The logo.** Set the word "knitted" in lowercase Bricolage Grotesque 800, with ".studio" in Geist Mono at about 40% of the size in `ink-muted`. The mark is two interlocking V chevrons on an `ember` tile with `radius-md` corners. No logo files exist yet; until they do, use the type-only wordmark.

## Components (guidance for building)

- **Primary button:** `ember` fill, `on-ember` text in `button` style, 40px tall, `radius-md`, horizontal padding `space-4`. Hover darkens by 8%; pressed uses `red`. One per view.
- **Secondary button:** transparent, 1px `line-strong` border, `ink` text. **Ghost button:** text only in `ink-muted`, turning `ink` on hover.
- **Destructive button:** `danger` text and border, with an icon and a word.
- **Sliders** (as in the image-adjust panel): a 2px track in `line-strong`, filled in `ember` up to a 14px thumb (`ink` fill with `ember` ring); the value in a 44px `surface-sunken` box in `code` style.
- **Pattern card:** a 4:5 or 1:1 thumbnail with `radius-md`, then the title in `label` and the size in `eyebrow` underneath. On hover it gets a `tint` background and the stitch outline.
- **Swatch chip:** a pill with 3–5 overlapping 16px color dots and the brand name.
- **AI prompt bar:** a floating `radius-pill` bar in `surface-raised` with `shadow-lift`, a `glow` shimmer along the top edge while the model works, and a send button in `ember`.
- **Effects tray:** square 72px thumbnails with `radius-md`; the selected one gets a 2px `ember` ring.

## Imagery

- Prefer warm studio photography against seamless color backdrops (orange, red, rust) that blend into the page field.
- Use a flat, layered illustration style for empty states and onboarding: 3–5 overlapping silhouette planes running from `glow` through `ember` and `red` to `oxblood`, with `surface` black for the nearest plane.
- Never use stock-blue tech imagery, purple gradients, emoji as decoration or 3D blobs.

## Voice

- Short, warm and confident. Use "you" for the user; the AI is "your model", never a character with a name.
- Use craft verbs: knit, stitch, pattern, swatch, finish. Say "Knit 12 posts", not "Generate 12 assets".
- Error messages say what happened and the fix in one line: "That logo is too small to print sharp. Upload one at least 1000px wide."

## Motion

- Keep motion to 160ms ease-out for UI, and 320ms for panels and modals.
- The signature motion is **stitching in**: new outputs appear by revealing top to bottom in 4–6 rows, like rows being knit. Respect reduced-motion settings by switching to a plain fade.
