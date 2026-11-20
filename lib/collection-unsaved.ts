/**
 * Background OpenAI jobs are server-owned. Their polling status is not a
 * user edit and must not block collection navigation or desktop reload.
 * All manually editable fields (including characters, prompts, images,
 * references, listing and thumbnail designs) remain protected.
 */
export function collectionHasUnsavedEdits(
  current: Record<string, unknown>,
  savedJson?: string,
): boolean {
  if (!savedJson) return true; // New, never-saved collection.
  let saved: Record<string, unknown>;
  try { saved = JSON.parse(savedJson) as Record<string, unknown>; }
  catch { return true; }
  const withoutRemoteJobStatus = (value: Record<string, unknown>) => {
    const { fullAutomation: _automation, researchJob: _research, promptJob: _prompt, ...editable } = value;
    void _automation; void _research; void _prompt;
    return editable;
  };
  return JSON.stringify(withoutRemoteJobStatus(current)) !==
    JSON.stringify(withoutRemoteJobStatus(saved));
}
