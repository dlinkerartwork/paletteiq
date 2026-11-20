# Image Reference Visual Reverse Engineering and Prompt DNA

This workflow implements the user-supplied **Clipart production .txt** brief in **PaletteIQ Research & Analysis**, **Character Library**, and **Generate Prompts**.

## Research: 12 reference-derived dimensions
AI Vision must analyze only user-selected reference images; listing title, description and tags provide intent but cannot prove a depicted object.

1. Character Shape Analysis: geometry, anatomy, proportions, recognizable silhouette
2. Facial Expression Analysis: eyes, pupils, highlights, mouth, blush and expression (if faces exist)
3. Color Palette Analysis: dominant/accent colors, gradients, combinations, relative distribution
4. Material & Texture Analysis: actual medium and surface finish
5. Special Effects Analysis: sparkle, glitter, shimmer, reflections and iridescence *only if visible*
6. Lighting & Rendering Analysis: soft/hard light, shading, reflections, ambient depth, 2D/3D cues
7. Character Category Analysis: animals, food, toys, fantasy, flora and objects actually observed
8. Accessories Analysis: observed ribbons, sprinkles, ornaments, toppings, etc.
9. Composition Analysis: framing, silhouette, perspective, crop and spacing
10. Illustration Quality Analysis: visual smoothness, antialiasing, line quality and dimensionality
11. Clipart Production Analysis: isolation, overlap, transparent PNG suitability and edge treatment
12. Commercial Asset Analysis: potential Etsy uses only; never invent delivered formats or licenses

The response stores `visualReverseEngineering`, `styleDNA`, `characterDNA`, reference image observations, theme/subtheme/microtheme, SEO signals, colors and mood separately.

**Style DNA** is *shared*: illustration medium, common shape language, palette logic, material, effects, lighting, outlines, rendering rules, composition and background. **Character DNA** is *individual*: species/object identity, unique anatomy and silhouette, face/expression, accessories, color roles and pose.

The sample *Cute Squishy Characters & Glitter Dumplings* suggests glossy 3D resin, pastel gradients and glitter, **but these are sample attributes**, NOT fixed PaletteIQ defaults. For watercolor, gouache, flat vector, ink, photorealistic food, retro or other inputs, follow the actual selected reference evidence. New blank collections intentionally have no preset visual style/texture/palette until analysis completes.

## Five controls

| Setting | Range | Behavior |
| --- | --- | --- |
| Style Consistency | 1–5 | Tightness of shared reference Style DNA |
| Character Variation | 1–5 | Desired breadth of subject families and silhouettes; higher levels apply a stricter per-family quota |
| Texture Control | 1–5 | Specificity of *observed* materials; never adds glitter/jelly/3D without evidence |
| Detail Quality | 1–5 | Prompt precision for edges, lighting and material finish |
| Prompt Quantity | 0–1000 | 0 = all eligible/selected prompts; positive numbers limit the next generation run |

Values are saved within each collection and passed through direct vision (OpenAI/Gemini), background research (OpenAI), AI Fill, foreground prompt generation (Gemini) and background Batch prompt generation (OpenAI). OpenAI Batch still limits one submission to 200 characters; split larger runs.

## Nine-part prompt formula

Each original individual asset prompt must describe:
1. Character Identity
2. Shape & Anatomy
3. Facial Expression, if the subject has a face
4. Color Palette
5. Material & Texture
6. Decorative Details
7. Lighting & Rendering
8. Composition: a fully visible, single isolated object
9. Output Requirements: intended transparent PNG and clean edges

Text prompts describe intended results. Actual resolution and alpha channel depend on the image-generation endpoint and output validation; a text prompt alone cannot guarantee dimensions or 300 DPI.

## QA boundaries
- Before generating, the app checks concept names, same-family repeated silhouette descriptors, distinct subject families, expression variants, accessory/color plan variation, missing DNA fields, and whether a common Style DNA/rendering rule exists.
- Character AI selection avoids exact duplicate names and sufficiently descriptive duplicated silhouette entries, with family quotas based on Character Variation.
- These checks concern *concept/prompt metadata*. Real visual similarity, alpha integrity, image edge quality and final Style DNA consistency require inspecting generated images and are not certified by this report.
- Reference observations remain separate from invented original expansion ideas; do not claim any invented element was pictured in the source reference.
- Existing collections remain loadable; re-run reference analysis to populate the new structured fields.
