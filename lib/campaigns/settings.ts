/**
 * Pure rules for the campaign composer settings, shared by the dashboard API,
 * the DM worker and (later) the REST/MCP layer.
 */

/**
 * Whether the link may be revealed after the person tapped "I'm following".
 *
 * Normal mode (default, unchanged behaviour): only a confirmed NON-follower is
 * turned away; if Instagram cannot say either way, the link goes out so a real
 * follower is never stuck.
 * Strict mode: only a confirmed follower gets the link. Unverifiable means no.
 */
export function followGateAllowsReveal(input: { strict: boolean; follows: boolean | null }): boolean {
  return input.strict ? input.follows === true : input.follows !== false;
}

export interface ComposerSettings {
  requireFollow: boolean;
  followGateStrict: boolean;
  textOnly: boolean;
  openingDmEnabled: boolean;
}

/** Returns a plain-language problem, or null when the combination works. */
export function validateComposerSettings(s: ComposerSettings): string | null {
  if (s.followGateStrict && !s.requireFollow) {
    return "The strict follow check needs the follow gate turned on";
  }
  if (s.textOnly && s.requireFollow) {
    return "Text-only messages cannot use the follow gate, because it needs a button to tap";
  }
  if (s.textOnly && s.openingDmEnabled) {
    return "Text-only messages cannot use an opening DM, because it needs a button to tap";
  }
  return null;
}

export interface ActivationFields {
  name: string;
  dmMessage: string;
  postId: string | null;
  matchAnyPost: boolean;
  pendingNextReel: boolean;
  matchAnyWord: boolean;
  keywords: string[];
}

/** What is still missing before a saved draft can go live. Empty means ready. */
export function missingForActivation(c: ActivationFields): string[] {
  const missing: string[] = [];
  if (!c.name.trim()) missing.push("a name");
  if (!c.dmMessage.trim()) missing.push("the message to send");
  if (!c.matchAnyPost && !c.pendingNextReel && !c.postId) missing.push("which post triggers it");
  if (!c.matchAnyWord && c.keywords.length === 0) missing.push("a keyword, or match any word");
  return missing;
}
