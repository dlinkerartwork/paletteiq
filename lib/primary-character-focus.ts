// Prefer a repeatedly named *character subject* in an Etsy listing title.
// This rule is intentionally conservative: broad themes like "farm animals"
// keep the existing diverse-family behavior, while "Fairy Clipart ..." focuses
// on fairies instead of filling the bundle with decorative garden objects.
const focalSubjects: Array<[RegExp,string]> = [
  [/\b(?:fairy|fairies)\b/gi,'fairy'],
  [/\b(?:mermaid|mermaids)\b/gi,'mermaid'],
  [/\b(?:princess|princesses)\b/gi,'princess'],
  [/\b(?:unicorn|unicorns)\b/gi,'unicorn'],
  [/\b(?:dragon|dragons)\b/gi,'dragon'],
  [/\b(?:dinosaur|dinosaurs)\b/gi,'dinosaur'],
  [/\b(?:gnome|gnomes)\b/gi,'gnome'],
  [/\b(?:angel|angels)\b/gi,'angel'],
  [/\b(?:ballerina|ballerinas)\b/gi,'ballerina'],
  [/\b(?:teddy bear|teddy bears)\b/gi,'teddy bear'],
];
export function primaryCharacterSubject(title: string): string | null {
  const normalized=title.toLowerCase();
  const ranked=focalSubjects.map(([pattern,subject])=>({
    subject,count:[...normalized.matchAll(pattern)].length,
  })).filter(item=>item.count>0).sort((a,b)=>b.count-a.count);
  if (!ranked.length) return null;
  // Avoid treating an incidental accessory as the hero of a listing which
  // explicitly names a different subject more often.
  return ranked[0].subject;
}
export const PRIMARY_CHARACTER_SHARE = 0.7;
export const primaryCharacterTarget = (target:number,subject:string|null) =>
  subject ? Math.min(target,Math.ceil(Math.max(0,target)*PRIMARY_CHARACTER_SHARE)) : 0;
export function isPrimaryCharacter(
  value: {name:string;family?:string},
  subject:string|null,
): boolean {
  if (!subject) return false;
  const group=((value.family||'')+' '+value.name).toLowerCase();
  if (subject==='fairy') return /\b(?:fairy|fairies|faerie|faeries|fae)\b/i.test(group);
  if (subject==='princess') return /\b(?:princess|princesses)\b/i.test(group);
  if (subject==='teddy bear') return /\bteddy\s*bear(?:s)?\b/i.test(group);
  return group.includes(subject);
}
