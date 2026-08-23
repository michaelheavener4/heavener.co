const USERNAME = 'michaelheavener4';
const CACHE_SECONDS = 300;

const githubHeaders = (env) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'heavener.co'
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
};

const github = async (path, env) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env),
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
  return response.json();
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=900',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
});

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const activityDetail = (event) => {
  const payload = event.payload || {};
  switch (event.type) {
    case 'PushEvent': {
      const count = payload.size || payload.commits?.length || 0;
      return plural(count, 'commit');
    }
    case 'PullRequestEvent':
      return `${payload.action || 'updated'} pull request${payload.number ? ` #${payload.number}` : ''}`;
    case 'IssuesEvent':
      return `${payload.action || 'updated'} issue${payload.issue?.number ? ` #${payload.issue.number}` : ''}`;
    case 'IssueCommentEvent':
      return `commented on issue #${payload.issue?.number || ''}`.trim();
    case 'CreateEvent':
      return `${payload.ref_type || 'repository'} created`;
    case 'DeleteEvent':
      return `${payload.ref_type || 'reference'} deleted`;
    case 'WatchEvent':
      return 'starred repository';
    case 'ForkEvent':
      return 'forked repository';
    case 'ReleaseEvent':
      return `${payload.action || 'published'} release`;
    default:
      return '';
  }
};

export async function onRequestGet({ env }) {
  try {
    const [profile, repos, events] = await Promise.all([
      github(`/users/${USERNAME}`, env),
      github(`/users/${USERNAME}/repos?per_page=100&sort=pushed&direction=desc`, env),
      github(`/users/${USERNAME}/events/public?per_page=50`, env)
    ]);

    const publicRepos = repos
      .filter((repo) => !repo.fork)
      .sort((a, b) => new Date(b.pushed_at || 0) - new Date(a.pushed_at || 0));

    const languages = [...new Set(publicRepos.map((repo) => repo.language).filter(Boolean))];
    const totalStars = publicRepos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const totalForks = publicRepos.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);

    const activity = events
      .filter((event) => event.repo?.name)
      .slice(0, 20)
      .map((event) => ({
        type: event.type,
        repo: event.repo.name,
        repo_url: `https://github.com/${event.repo.name}`,
        created_at: event.created_at,
        detail: activityDetail(event)
      }));

    return json({
      profile: {
        handle: profile.login,
        name: profile.name,
        bio: profile.bio,
        avatar_url: profile.avatar_url,
        html_url: profile.html_url,
        public_repos: profile.public_repos,
        followers: profile.followers,
        following: profile.following,
        created_at: profile.created_at
      },
      stats: {
        repositories: publicRepos.length,
        stars: totalStars,
        forks: totalForks,
        languages
      },
      repos: publicRepos.map((repo) => ({
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        language: repo.language,
        topics: repo.topics || [],
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        pushed_at: repo.pushed_at,
        updated_at: repo.updated_at,
        archived: repo.archived
      })),
      activity,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'GitHub API unavailable' }, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
