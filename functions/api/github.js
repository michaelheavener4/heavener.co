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
    ...(privateRequest ? {} : {
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('GitHub request failed', {
      path,
      status: response.status,
      body
    });
    throw new Error(
      `GitHub ${path} returned ${response.status}: ${body}`
    );
  }

  return response.json();
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    // The page is explicitly a live portfolio. Do not let the public API
    // response itself become stale after a token/project update.
    'Cache-Control': 'no-store',
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
      return count ? plural(count, 'commit') : 'code updated';
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

// Privacy boundary: private repositories are represented only by harmless
// portfolio metadata. No private URL, ID, branch, commit, path, diff, issue,
// or source content is returned to the browser.
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

    // GitHub's public event feed can contain many nearly-identical PushEvents
    // for a single project. Keep only the latest meaningful event per repo.
    const publicActivityByRepo = new Map();
    publicEvents
      .filter((event) => event.repo?.name && event.repo.name.split('/')[0] === USERNAME)
      .forEach((event) => {
        const repoName = event.repo.name.split('/')[1];
        if (!publicActivityByRepo.has(repoName)) {
          publicActivityByRepo.set(repoName, {
            type: event.type,
            repo: repoName,
            repo_url: `https://github.com/${event.repo.name}`,
            created_at: event.created_at,
            detail: activityDetail(event),
            private: false
          });
        }
      });

    publicRepos.forEach((repo) => {
      if (!publicActivityByRepo.has(repo.name) && repoUpdatedAt(repo)) {
        publicActivityByRepo.set(repo.name, {
          type: 'ProjectEvent',
          repo: repo.name,
          repo_url: repo.html_url,
          created_at: repoUpdatedAt(repo),
          detail: 'project updated',
          private: false
        });
      }
    });

    const publicActivity = [...publicActivityByRepo.values()];

    // Reduce authenticated private activity to a generic project update before
    // it reaches the browser. No GitHub private event payload is exposed.
    let privateActivity = [];
    if (authenticated && privateRepos.length) {
      try {
        const events = await github('/user/events?per_page=50', env, { privateRequest: true });
        const privateNames = new Set(privateRepos.map((repo) => repo.full_name));
        const privateActivityByRepo = new Map();
        events
          .filter((event) => event.repo?.name && privateNames.has(event.repo.name))
          .forEach((event) => {
            const repoName = event.repo.name.split('/').pop();
            if (!privateActivityByRepo.has(repoName)) {
              privateActivityByRepo.set(repoName, {
                type: 'PrivateProjectEvent',
                repo: repoName,
                created_at: event.created_at,
                detail: event.type === 'PushEvent' ? 'code updated' : 'project activity',
                private: true
              });
            }
          });
        privateActivity = [...privateActivityByRepo.values()];
      } catch (_) {
        privateActivity = [];
      }
    }

    // Repository timestamps guarantee that a private project still appears
    // even when GitHub's event feed has expired the individual event.
    privateRepos.forEach((repo) => {
      if (!privateActivity.some((event) => event.repo === repo.name) && repoUpdatedAt(repo)) {
        privateActivity.push({
          type: 'PrivateProjectEvent',
          repo: repo.name,
          created_at: repoUpdatedAt(repo),
          detail: 'project updated',
          private: true
        });
      }
    });

    const activity = [...publicActivity, ...privateActivity]
      .filter((event) => event.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 12);

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
    console.error('GitHub API error:', error);
    return json({
      error: 'GitHub API unavailable',
      detail: error instanceof Error ? error.message : String(error)
    }, 502);
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
