# PaletteIQ SEO settings — Web QA

Branch: feature/multi-collection-production-refresh

## Settings
1. Open Settings. Configure an encrypted Gemini API key (or use OpenAI).
2. In SEO generation settings, select OpenAI or Gemini.
3. Set maximum title characters (default 120; allowed 1–140).
4. Set number of image alt texts (default 10; allowed 1–20).
5. Confirm each alt text has a maximum of 450 characters.
6. File naming is fixed to generaltheme_imagenumber; for example flowers_blossoms_001.png.
7. Save SEO settings, refresh the browser, and verify values persist.
8. Export settings backup: verify no OpenAI or Gemini API key is present.

## Generate and review
1. Create a collection with a saved theme and some subject names.
2. Select configured SEO provider. Generate SEO draft (this makes a paid/external API call).
3. Confirm title length <= configured max and alt-text count equals configured amount.
4. Confirm each alt text length <= 450; inspect factual accuracy before publishing.
5. Run Advanced SEO Review and verify it uses the selected provider.
6. Verify missing provider credentials produce a clear error.

## Filename
1. Save collection and export image ZIP after real images exist.
2. Confirm filenames follow <generaltheme>_<001..NNN>.<extension>.
3. Check images match the same collection and retain original binary content.

## Static checks
```powershell
npx tsc --noEmit
npm run test:production
npx eslint app components lib db --ignore-pattern "dist/**" --ignore-pattern "release/**" --ignore-pattern ".next/**"
npm run build
```

## Important
- Title and alt-text limits are verified by the server; the AI provider still determines content quality.
- A draft with too few generated alt texts is rejected with a clear count instead of being silently padded with invented descriptions.
- This migration adds encrypted gemini_credential to studio_settings; apply Drizzle migrations before testing settings.
- Gemini and OpenAI may incur their respective API costs. Mock image generation is separate.
- Desktop packaging is not covered by this change.
