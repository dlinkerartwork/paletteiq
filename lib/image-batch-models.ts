// Explicit Batch API capability policy. /v1/models lists accessible IDs but
// does NOT provide endpoint-specific Batch support. Keep this list verified
// against OpenAI's Image Batch endpoint before adding another model.
export const IMAGE_BATCH_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const;
export const DEFAULT_IMAGE_BATCH_MODEL: string = 'gpt-image-2.5-flare';
export const isImageBatchModel = (value: unknown): value is string =>
  typeof value === 'string' && IMAGE_BATCH_MODELS.some(model => model === value);
export const imageBatchModelError = (value: unknown) =>
  'The selected image model (' + String(value || 'none') +
  ') has not been verified for OpenAI Image Batch. Choose a Batch-compatible model in Settings → Production defaults. No paid Batch was submitted.';
