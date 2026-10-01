import { ProviderError } from '../lib/errors.ts';
import { getText, type FetchLike, type TextResponse } from '../lib/http.ts';
import type { RobotsPolicy } from './robots.ts';

/**
 * Shared rules for the web-scraping providers: robots.txt first, an honest User-Agent, and any bot
 * challenge, CAPTCHA or block treated as a failure. Challenges are never solved, and browser cookies
 * such as Cloudflare's `cf_clearance` are never replayed.
 */

/** The page cannot answer this request (robots.txt, a date the page doesn't cover, ...): skip retries. */
export class ScraperNotApplicableError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, 'PROVIDER_UNAVAILABLE', message);
    this.name = 'ScraperNotApplicableError';
  }
}

/**
 * Detects an interstitial bot check or CAPTCHA (not the passive Cloudflare script that many normal pages
 * load from /cdn-cgi/challenge-platform/, which is harmless).
 */
export function looksLikeBotChallenge(res: Pick<TextResponse, 'status' | 'headers' | 'text'>): boolean {
  if (res.headers.get('cf-mitigated') === 'challenge') return true;
  const head = res.text.slice(0, 20_000);
  return (
    /<title>\s*(just a moment|attention required|access denied|security check)/i.test(head) ||
    /cf-chl-|cf_chl_opt|cf-turnstile|g-recaptcha|h-captcha|hcaptcha\.com|recaptcha\/api/i.test(res.text) ||
    /are you a (robot|human)|verify you are human/i.test(head)
  );
}

export async function fetchPublicPage(input: {
  provider: string;
  siteName: string;
  origin: string;
  path: string;
  robots: RobotsPolicy;
  userAgent: string;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}): Promise<string> {
  if (!(await input.robots.isAllowed(input.path))) {
    throw new ScraperNotApplicableError(input.provider, `${input.siteName}'s robots.txt does not allow this page to be fetched automatically.`);
  }
  const res = await getText(input.provider, `${input.origin}${input.path}`, {
    headers: { 'user-agent': input.userAgent, accept: 'text/html', 'accept-language': 'en-IN,en;q=0.9' },
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    followRedirects: true,
  });
  if (looksLikeBotChallenge(res)) {
    throw new ProviderError(input.provider, 'PROVIDER_UNAVAILABLE', `${input.siteName} asked for a CAPTCHA/bot check; not bypassing it.`, {
      httpStatus: res.status,
    });
  }
  if (res.status === 429) {
    throw new ProviderError(input.provider, 'RATE_LIMITED', `${input.siteName} is rate limiting requests.`, { httpStatus: 429, retryAfterSeconds: 60 });
  }
  if (!res.ok) {
    throw new ProviderError(input.provider, 'PROVIDER_UNAVAILABLE', `${input.siteName} returned HTTP ${res.status}.`, { httpStatus: res.status });
  }
  return res.text;
}
