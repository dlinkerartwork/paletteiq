/**
 * A background Prompt/Image Batch may have saved useful paid output while
 * another open editor still holds an older collection snapshot. Preserve
 * the prompt that generated an existing PNG (or was imported successfully
 * from a paid Prompt receipt) when that editor submits an empty prompt.
 *
 * Nonempty edits remain editable: a real new prompt always wins. Empty
 * prompts without a saved generated image or completed paid receipt remain
 * intentionally clearable in the normal editor.
 */
export type PromptLineage = {
  id:string; prompt?:string; imageUrl?:string; status?:string;
};

export function preserveSavedPromptLineage<T extends PromptLineage>(
  incoming:readonly T[], saved:readonly PromptLineage[],
  completedPaidPromptIds:ReadonlySet<string>=new Set<string>(),
):T[]{
  const byId=new Map(saved.map(subject=>[subject.id,subject]));
  return incoming.map(subject=>{
    const previous=byId.get(subject.id);
    if(!previous || !previous.prompt?.trim() || subject.prompt?.trim())return subject;
    // Never silently drop the saved source prompt for a PNG merely because
    // the browser's Collection snapshot was older than the image import.
    const hasImage=!!(previous.imageUrl||subject.imageUrl);
    if(!hasImage && !completedPaidPromptIds.has(subject.id))return subject;
    return {...subject,prompt:previous.prompt};
  });
}

export function imageWithoutPromptCount(
  subjects:readonly PromptLineage[],
):number {
  return subjects.filter(subject=>!!subject.imageUrl && !subject.prompt?.trim()).length;
}
