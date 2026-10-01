import { getText, type FetchLike } from '../lib/http.ts';

/**
 * Minimal robots.txt support (RFC 9309) for the web-scraping provider:
 *  - the group for our user-agent token is used, otherwise the `*` group;
 *  - the longest matching rule wins, `Allow` wins ties; `*` wildcards and `$` anchors are supported;
 *  - 4xx (no robots.txt) allows everything; 5xx or an unreachable server disallows everything.
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

export function parseRobots(text: string, userAgentToken: string): RobotsRules {
  const token = userAgentToken.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.rules.allow.push(value);
    if (field === 'disallow' && value) current.rules.disallow.push(value);
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    allow: chosen.flatMap((g) => g.rules.allow),
    disallow: chosen.flatMap((g) => g.rules.disallow),
  };
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const regex = new RegExp(`^${body.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return regex.test(path);
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) => Math.max(-1, ...list.filter((r) => ruleMatches(r, path)).map((r) => r.length));
  return longest(rules.allow) >= longest(rules.disallow);
}

const DAY_MS = 86_400_000;

export class RobotsPolicy {
  private cached: { at: number; rules: RobotsRules | 'allow-all' | 'disallow-all' } | null = null;

  constructor(
    private readonly options: {
      origin: string;
      userAgent: string;
      userAgentToken: string;
      providerId: string;
      timeoutMs: number;
      fetchImpl?: FetchLike;
      ttlMs?: number;
    },
  ) {}

  async isAllowed(path: string): Promise<boolean> {
    const rules = await this.load();
    if (rules === 'allow-all') return true;
    if (rules === 'disallow-all') return false;
    return isPathAllowed(rules, path);
  }

  private async load(): Promise<RobotsRules | 'allow-all' | 'disallow-all'> {
    const ttl = this.options.ttlMs ?? DAY_MS;
    if (this.cached && Date.now() - this.cached.at < (this.cached.rules === 'disallow-all' ? 10 * 60_000 : ttl)) return this.cached.rules;
    let rules: RobotsRules | 'allow-all' | 'disallow-all';
    try {
      const res = await getText(this.options.providerId, `${this.options.origin}/robots.txt`, {
        headers: { 'user-agent': this.options.userAgent, accept: 'text/plain' },
        timeoutMs: this.options.timeoutMs,
        fetchImpl: this.options.fetchImpl,
        followRedirects: true,
      });
      if (res.ok) rules = parseRobots(res.text, this.options.userAgentToken);
      else if (res.status >= 400 && res.status < 500) rules = 'allow-all';
      else rules = 'disallow-all';
    } catch {
      // Unreachable: be conservative and retry sooner (shorter cache for this outcome).
      rules = 'disallow-all';
    }
    this.cached = { at: Date.now(), rules };
    return rules;
  }
}
