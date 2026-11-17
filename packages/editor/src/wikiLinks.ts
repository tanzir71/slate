export interface WikiLinkHit {
  from: number;
  to: number;
  raw: string;
  target: string;
  display: string;
  targetId: string | undefined;
}

export function findWikiLinkAtPosition(
  markdown: string,
  position: number,
): WikiLinkHit | undefined {
  for (const match of markdown.matchAll(
    /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
  )) {
    const from = match.index;
    const raw = match[0];
    if (position < from || position >= from + raw.length) continue;
    const target = match[1]!.trim();
    const targetId = /^(?:id:)?01[0-9A-HJKMNP-TV-Z]{24}$/i.test(target)
      ? target.replace(/^id:/i, "").toUpperCase()
      : undefined;
    return {
      from,
      to: from + raw.length,
      raw,
      target: targetId ?? target,
      display: (match[2] ?? target).trim(),
      targetId,
    };
  }
  return undefined;
}
