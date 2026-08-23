const USERNAME = 'michaelheavener4';
const CACHE_SECONDS = 120;

const githubHeaders = (env) => {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'heavener.co'
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return headers;
};

const github = async (path, env, { privateRequest = false } = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(env),
    // Never cache authenticated/private GitHub responses at the edge. A cached
    // unauthenticated /user/repos response would otherwise hide private repos.
    ...(privateRequest ? {} : { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } })
  });
  if (!response.ok) throw new Error(`GitHub ${path} returned ${response.status}`);
  return response.json();
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
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

const repoUpdatedAt = (repo) => repo.pushed_at || repo.updated_at || null;

const publicRepoView = (repo) => ({
  name: repo.name,
  full_name: repo.full_name,
  html_url: repo.html_url,
  description: repo.description,
  language: repo.language,
  topics: repo.topics || [],
  stars: repo.stargazers_count || 0,
  forks: repo.forks_count || 0,
  pushed_at: repo.pushed_at,
  updated_at: repo.updated_at,
  archived: repo.archived
});

// This is the privacy boundary. Private repositories are represented only by
// harmless portfolio metadata. No private URL, ID, branch, commit, path, diff,
// issue, or source content is returned to the browser.
const privateProjectView = (repo) => {
  const pushedAt = repoUpdatedAt(repo);
  const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return {
    name: repo.name,
    description: repo.description || 'Private software project.',
    language: repo.language || null,
    label: 'PRIVATE · ACTIVE',
    status: pushedAt && new Date(pushedAt).getTime() >= recentCutoff ? 'active' : 'maintained',
    pushed_at: pushedAt,
    updated_at: repo.updated_at || null
  };
};

export async function onRequestGet({ env }) {
  try {
    const authenticated = Boolean(env.GITHUB_TOKEN);

    const profilePromise = github(`/users/${USERNAME}`, env);

    // /user/repos is required for private repositories. It is intentionally
    // uncached because its response depends on the bearer token.
    const reposPromise = authenticated
      ? github('/user/repos?per_page=100&affiliation=owner&sort=pushed&direction=desc', env, { privateRequest: true })
      : github(`/users/${USERNAME}/repos?per_page=100&sort=pushed&direction=desc`, env);

    const [profile, repos] = await Promise.all([profilePromise, reposPromise]);

    const ownedRepos = repos
      .filter((repo) => !repo.fork && repo.owner?.login === USERNAME)
      .sort((a, b) => new Date(repoUpdatedAt(b) || 0) - new Date(repoUpdatedAt(a) || 0));

    const publicRepos = ownedRepos.filter((repo) => !repo.private);
    const privateRepos = authenticated ? ownedRepos.filter((repo) => repo.private) : [];

    const languages = [...new Set(publicRepos.map((repo) => repo.language).filter(Boolean))];
    const totalStars = publicRepos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const totalForks = publicRepos.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);

    let publicEvents = [];
    try {
      publicEvents = await github(`/users/${USERNAME}/events/public?per_page=50`, env);
    } catch (_) {
      publicEvents = [];
    }

    const publicActivity = publicEvents
      .filter((event) => event.repo?.name && event.repo.name.split('/')[0] === USERNAME)
      .slice(0, 15)
      .map((event) => ({
        type: event.type,
        repo: event.repo.name.split('/')[1],
        repo_url: `https://github.com/${event.repo.name}`,
        created_at: event.created_at,
        detail: activityDetail(event),
        private: false
      }));

    // GitHub's authenticated user-events feed can contain private activity.
    // We deliberately reduce it to a generic project update before returning it.
    let privateActivity = [];
    if (authenticated && privateRepos.length) {
      try {
        const events = await github('/user/events?per_page=50', env, { privateRequest: true });
        const privateNames = new Set(privateRepos.map((repo) => repo.full_name));
        privateActivity = events
          .filter((event) => event.repo?.name && privateNames.has(event.repo.name))
          .map((event) => ({
            type: 'PrivateProjectEvent',
            repo: event.repo.name.split('/').pop(),
            created_at: event.created_at,
            detail: event.type === 'PushEvent' ? 'code updated' : 'project activity',
            private: true
          }));
      } catch (_) {
        privateActivity = [];
      }
    }

    // Repository timestamps guarantee that a private project still appears in
    // the feed even when GitHub's event feed has expired the individual event.
    const timestampFallbacks = privateRepos.map((repo) => ({
      type: 'PrivateProjectEvent',
      repo: repo.name,
      created_at: repoUpdatedAt(repo),
      detail: 'project updated',
      private: true
    }));

    const activity = [...publicActivity, ...privateActivity, ...timestampFallbacks]
      .filter((event) => event.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .filter((event, index, list) => {
        if (!event.private) return true;
        return list.findIndex((candidate) => candidate.private && candidate.repo === event.repo) === index;
      })
      .slice(0, 30);

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
        repositories: ownedRepos.length,
        public_repositories: publicRepos.length,
        private_repositories: privateRepos.length,
        stars: totalStars,
        forks: totalForks,
        languages
      },
      private_projects: privateRepos.map(privateProjectView),
      repos: publicRepos.map(publicRepoView),
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
