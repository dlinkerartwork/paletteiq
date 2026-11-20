/**
 * Estimate ONE square OpenAI image-generation request, excluding the separate
 * GPT-4.1-mini Vision layout and QC calls, storage, and any retries.
 *
 * Prices: https://developers.openai.com/api/docs/pricing
 * Older-model square output estimates: https://developers.openai.com/api/docs/guides/image-generation
 * Model pricing can change. This is NEVER the official invoice.
 */
export type GeneratedImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { text_tokens?: number; image_tokens?: number };
};
export type ImageGenerationCostEstimate = {
  usd: number;
  basis: 'reported-usage' | 'published-square-output';
};

type Rates = {
  textInputPerMillion: number;
  imageInputPerMillion: number;
  imageOutputPerMillion: number;
  outputExample?: Record<'low' | 'medium' | 'high', number>;
};

function pricingForModel(model: string): Rates | null {
  if (/^gpt-image-1-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { textInputPerMillion: 2, imageInputPerMillion: 2.5, imageOutputPerMillion: 8,
      outputExample: { low: 0.005, medium: 0.011, high: 0.036 } };
  }
  if (/^gpt-image-1\.5(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { textInputPerMillion: 5, imageInputPerMillion: 8, imageOutputPerMillion: 32,
      outputExample: { low: 0.009, medium: 0.034, high: 0.133 } };
  }
  if (/^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { textInputPerMillion: 2.5, imageInputPerMillion: 4, imageOutputPerMillion: 15,
      outputExample: { low: 0.006, medium: 0.053, high: 0.211 } };
  }
  if (/^gpt-image-2\.[56]-(?:flare|sunburst)(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { textInputPerMillion: 5, imageInputPerMillion: 8, imageOutputPerMillion: 30 };
  }
  return null;
}

const validCount = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isSafeInteger(n);

export function estimateListingImageGenerationCost(
  model: string, quality: 'low' | 'medium' | 'high', usage?: GeneratedImageUsage
): ImageGenerationCostEstimate | null {
  const price = pricingForModel(model);
  if (!price) return null;

  if (usage && validCount(usage.output_tokens) && usage.output_tokens > 0) {
    const details = usage.input_tokens_details;
    // This operation only sends a TEXT prompt to /images/generations, never
    // original clipart/image inputs. If details are missing, input is text.
    const textTokens = validCount(details?.text_tokens)
      ? details.text_tokens : validCount(usage.input_tokens) ? usage.input_tokens : 0;
    const imageTokens = validCount(details?.image_tokens) ? details.image_tokens : 0;
    const cost = (
      usage.output_tokens * price.imageOutputPerMillion +
      textTokens * price.textInputPerMillion +
      imageTokens * price.imageInputPerMillion
    ) / 1_000_000;
    if (Number.isFinite(cost) && cost > 0) {
      return { usd: cost, basis: 'reported-usage' };
    }
  }

  // This fallback is a published model+quality output example, not the total
  // request price. Never return zero for an unsupported/new/unknown model.
  const output = price.outputExample?.[quality];
  return output && output > 0
    ? { usd: output, basis: 'published-square-output' }
    : null;
}
