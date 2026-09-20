import { NextResponse } from 'next/server';
import {
  fetchSafeAgentWebUrl,
  readAgentWebResponseText,
} from '@/lib/agent-web-security';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source?: 'bing-web' | 'bing-news' | 'duckduckgo-html' | 'duckduckgo-instant';
};

type SearchPlan = {
  rawQuery: string;
  queries: string[];
  wantsFresh: boolean;
  gptIntent: boolean;
};

function decodeHtml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(input: string): string {
  return decodeHtml(input.replace(/<[^>]*>/g, ' '));
}

function parseAllowedDomains(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma-separated parsing.
  }
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function normalizeDuckDuckGoUrl(url: string): string {
  const decoded = decodeHtml(url);
  try {
    const parsed = new URL(decoded, 'https://duckduckgo.com');
    const bingTarget = parsed.hostname.includes('bing.com') ? parsed.searchParams.get('url') : '';
    if (bingTarget) return decodeURIComponent(bingTarget);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return decoded;
  }
}

function domainAllowed(url: string, domains: string[]): boolean {
  if (domains.length === 0) return true;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return domains.some((domain) => {
      const normalized = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function cleanUserSearchQuery(rawQuery: string): string {
  let q = rawQuery.trim();
  q = q.replace(/[？?。！!，,；;]+$/g, '').trim();
  q = q.replace(/^(请|麻烦|帮我|给我|你帮我)?\s*(联网|上网|在网上)?\s*(web\s*search|websearch|search|google|bing|搜索|搜一下|查询|查一下|查阅|检索|浏览)\s*(一下)?\s*(关于|有关)?\s*/iu, '');
  q = q.replace(/^关于\s*/u, '');
  q = q.replace(/的?(最新)?(消息|新闻|动态|资讯)$/u, '').trim();
  return q || rawQuery.trim();
}

function buildSearchPlan(rawQuery: string): SearchPlan {
  const cleaned = cleanUserSearchQuery(rawQuery);
  const wantsFresh = /最新|新闻|消息|动态|资讯|近期|最近|今天|latest|news|update|updates/i.test(rawQuery);
  const gptIntent = /(^|[^a-z])gpt([^a-z]|$)|chatgpt|openai|gpt-\d|gpt\d/i.test(rawQuery);
  const currentYear = String(new Date().getFullYear());
  const topic = gptIntent && !/chatgpt|openai/i.test(cleaned)
    ? cleaned.replace(/(^|[^a-z])gpt([^a-z]|$)/i, '$1OpenAI ChatGPT GPT$2').trim()
    : cleaned;
  const freshSuffix = wantsFresh ? ` latest news ${currentYear}` : '';
  const queries = uniqueStrings([
    wantsFresh ? `${topic}${freshSuffix}` : topic,
    wantsFresh ? `${topic} 最新消息` : '',
    wantsFresh ? `${topic} news` : '',
    rawQuery,
  ]);
  return { rawQuery, queries, wantsFresh, gptIntent };
}

function searchText(result: SearchResult): string {
  return `${result.title} ${result.url} ${result.snippet}`.toLowerCase();
}

function isRelevantResult(result: SearchResult, plan: SearchPlan): boolean {
  const hay = searchText(result);
  if (plan.gptIntent) {
    const hasAiGptContext = /\bopenai\b|chatgpt|\bgpt[-\s]?\d|\bgpt\b|generative pre-trained transformer/.test(hay);
    if (!hasAiGptContext) return false;
    const travelOnly = /aer lingus|airline|flight|flights|airport|gulfport|biloxi|行李|航班|机票|机场|预订/.test(hay);
    const hasOpenAiContext = /\bopenai\b|chatgpt|artificial intelligence|generative ai|ai chatbot/.test(hay);
    if (travelOnly && !hasOpenAiContext) return false;
  }
  return true;
}

function scoreResult(result: SearchResult, plan: SearchPlan): number {
  const hay = searchText(result);
  let score = 0;
  if (plan.gptIntent) {
    if (/\bopenai\b/.test(hay)) score += 8;
    if (/chatgpt/.test(hay)) score += 8;
    if (/\bgpt[-\s]?\d|\bgpt\b/.test(hay)) score += 4;
  }
  if (plan.wantsFresh) {
    if (result.source === 'bing-news') score += 10;
    if (/news|latest|update|updates|announces|launches|released|最新|新闻|动态|发布|推出/.test(hay)) score += 4;
    if (new Date().getFullYear().toString() && hay.includes(new Date().getFullYear().toString())) score += 2;
  }
  try {
    const hostname = new URL(result.url).hostname.replace(/^www\./i, '').toLowerCase();
    if (hostname.includes('openai.com')) score += 6;
    if (plan.wantsFresh && hostname.includes('openai.com') && /\/index\/(chatgpt|gpt-4)\/?$/i.test(new URL(result.url).pathname)) {
      score -= 12;
    }
    if (hostname.includes('theverge.com') || hostname.includes('techcrunch.com') || hostname.includes('reuters.com')) score += 3;
  } catch {
    // Ignore malformed URLs; they will get no domain bonus.
  }
  return score;
}

function dedupeAndFilter(results: SearchResult[], domains: string[], plan: SearchPlan): SearchResult[] {
  const seen = new Set<string>();
  const filtered: Array<{ result: SearchResult; score: number; index: number }> = [];
  for (const result of results) {
    if (!result.url || !result.title.trim() || !domainAllowed(result.url, domains)) continue;
    try {
      const url = new URL(result.url);
      if (url.hostname.replace(/^www\./i, '').toLowerCase() === 'duckduckgo.com' && url.pathname === '/') continue;
    } catch {
      continue;
    }
    const key = result.url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    if (!isRelevantResult(result, plan)) continue;
    seen.add(key);
    filtered.push({ result, score: scoreResult(result, plan), index: filtered.length });
  }
  return filtered
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.result)
    .slice(0, 8);
}

function formatSearchResults(results: SearchResult[], plan: SearchPlan): string {
  const lines = results
    .map((r, index) => {
      const snippet = r.snippet ? `\n  摘要: ${r.snippet}` : '';
      return `${index + 1}. ${r.title}\n  URL: ${r.url}${snippet}`;
    })
    .join('\n');
  return `实际搜索词: ${plan.queries[0]}\n${lines}`;
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetchSafeAgentWebUrl(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MagineCanvas/1.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseRssResults(xml: string, source: SearchResult['source']): SearchResult[] {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)];
  return items.map((item) => {
    const block = item[0];
    const title = stripHtml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
    const link = normalizeDuckDuckGoUrl(stripHtml(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ''));
    const snippet = stripHtml(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '');
    return { title, url: link, snippet, source };
  });
}

async function searchBingRss(query: string): Promise<SearchResult[]> {
  const xml = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`, 10000);
  return parseRssResults(xml, 'bing-web');
}

async function searchBingNewsRss(query: string): Promise<SearchResult[]> {
  const xml = await fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`, 10000);
  return parseRssResults(xml, 'bing-news');
}

async function searchDuckDuckGoHtml(query: string): Promise<SearchResult[]> {
  const html = await fetchText(`https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`, 10000);
  const blocks = [...html.matchAll(/<div class="result[\s\S]*?(?=<div class="result|<\/body>)/gi)];
  return blocks.map((blockMatch) => {
    const block = blockMatch[0];
    const linkMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    const title = stripHtml(linkMatch?.[2] || '');
    const url = normalizeDuckDuckGoUrl(linkMatch?.[1] || '');
    const snippet = stripHtml(snippetMatch?.[1] || snippetMatch?.[2] || '');
    return { title, url, snippet, source: 'duckduckgo-html' };
  });
}

function collectInstantAnswerTopics(value: unknown, out: SearchResult[]): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const topic = item as Record<string, unknown>;
    if (Array.isArray(topic.Topics)) collectInstantAnswerTopics(topic.Topics, out);
    const text = typeof topic.Text === 'string' ? topic.Text : '';
    const url = typeof topic.FirstURL === 'string' ? topic.FirstURL : '';
    if (text && url) out.push({ title: text.split(' - ')[0] || text, url, snippet: text, source: 'duckduckgo-instant' });
  }
}

async function searchDuckDuckGoInstantAnswer(query: string): Promise<SearchResult[]> {
  const res = await fetchSafeAgentWebUrl(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const results: SearchResult[] = [];
  collectInstantAnswerTopics(data.RelatedTopics, results);
  if (typeof data.AbstractText === 'string' && typeof data.AbstractURL === 'string' && data.AbstractText) {
    results.unshift({
      title: typeof data.Heading === 'string' && data.Heading ? data.Heading : data.AbstractText.slice(0, 80),
      url: data.AbstractURL,
      snippet: data.AbstractText,
      source: 'duckduckgo-instant',
    });
  }
  return results;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = (body.action as string) || '';

    switch (action) {
      case 'search': {
        const query = String(body.query || '');
        if (!query) return NextResponse.json({ success: false, message: '缺少 query' });

        const allowedDomains = parseAllowedDomains(body.allowed_domains);
        const plan = buildSearchPlan(query);
        const errors: string[] = [];
        try {
          const sources = plan.wantsFresh
            ? [searchBingNewsRss, searchBingRss, searchDuckDuckGoHtml, searchDuckDuckGoInstantAnswer]
            : [searchBingRss, searchDuckDuckGoHtml, searchDuckDuckGoInstantAnswer];
          const collected: SearchResult[] = [];
          for (const plannedQuery of plan.queries) {
            for (const source of sources) {
              try {
                collected.push(...await source(plannedQuery));
              } catch (e) {
                errors.push(e instanceof Error ? e.message : String(e));
              }
            }
          }
          const results = dedupeAndFilter(collected, allowedDomains, plan);
          if (results.length > 0) {
            return NextResponse.json({
              success: true,
              message: `搜索结果:\n${formatSearchResults(results, plan)}`,
            });
          }
          return NextResponse.json({
            success: false,
            message: errors.length
              ? `未找到与「${plan.queries[0]}」相关的可用搜索结果。搜索源返回：${errors.slice(0, 3).join('；')}`
              : '未找到相关结果',
          });
        } catch {
          return NextResponse.json({ success: false, message: '搜索请求超时，请稍后重试' });
        }
      }

      case 'fetch': {
        const url = String(body.url || '');
        if (!url) return NextResponse.json({ success: false, message: '缺少 url' });

        try {
          const res = await fetchSafeAgentWebUrl(url, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MagineCanvas/1.0 Safari/537.36',
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) {
            return NextResponse.json({ success: false, message: `获取网页失败：HTTP ${res.status}` });
          }
          const text = await readAgentWebResponseText(res);
          const snippet = stripHtml(text).slice(0, 3000);
          return NextResponse.json({
            success: true,
            message: snippet || '(页面内容为空)',
          });
        } catch {
          return NextResponse.json({ success: false, message: '获取网页失败，请检查 URL 是否正确' });
        }
      }

      case 'test_api': {
        const kind = String(body.kind || '');
        return NextResponse.json({
          success: true,
          message: `${kind} API 连接测试：请在客户端通过 API 配置面板测试连通性`,
        });
      }

      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` });
    }
  } catch (e) {
    return NextResponse.json(
      { success: false, message: e instanceof Error ? e.message : '服务器内部错误' },
      { status: 500 }
    );
  }
}
