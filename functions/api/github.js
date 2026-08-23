const USERNAME = 'michaelheavener4';
const CACHE_SECONDS = 120;

const PRIVATE_PROJECTS = {
  'x-growth-agent': {
    description: 'Autonomous tooling for experimentation, analytics, and X growth.',
    label: 'PRIVATE · ACTIVE'
  },
  dashcommand: {
    description: 'Agent orchestration and mission-control tooling.',
    label: 'PRIVATE · ACTIVE'
  }
};

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

const repoSnapshot = (repo) => ({
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
  archived: repo.archived,
  private: Boolean(repo.private)
});

export async function onRequestGet({ env }) {
  try {
    const [profile, repos] = await Promise.all([
      github(`/users/${USERNAME}`, env),
      env.GITHUB_TOKEN
        ? github('/user/repos?per_page=100&affiliation=owner&sort=pushed&direction=desc', env)
        : github(`/users/${USERNAME}/repos?per_page=100&sort=pushed&direction=desc`, env)
    ]);

    const ownedRepos = repos.filter((repo) => !repo.fork && repo.owner?.login === USERNAME);
    const publicRepos = ownedRepos.filter((repo) => !repo.private);
    const privateRepos = ownedRepos.filter((repo) => repo.private);

    const languages = [...new Set(publicRepos.map((repo) => repo.language).filter(Boolean))];
    const totalStars = publicRepos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0);
    const totalForks = publicRepos.reduce((sum, repo) => sum + (repo.forks_count || 0), 0);

    // Public GitHub events are still useful for public activity. Private activity is
    // represented separately using repository metadata + timestamps so no private
    // commit messages, paths, diffs, URLs, or source contents are exposed.
    let events = [];
    try {
      events = await github(`/users/${USERNAME}/events/public?per_page=50`, env);
    } catch (_) {
      events = [];
    }

    const publicActivity = events
      .filter((event) => event.repo?.name && event.repo.name.split('/')[0] === USERNAME)
      .slice(0, 12)
      .map((event) => ({
        type: event.type,
        repo: event.repo.name.split('/')[1],
        repo_url: `https://github.com/${event.repo.name}`,
        created_at: event.created_at,
        detail: activityDetail(event),
        private: false
      }));

    const privateActivity = await Promise.all(privateRepos.map(async (repo) => {
      let latestCommitAt = repo.pushed_at || repo.updated_at;
      try {
        const commits = await github(`/repos/${USERNAME}/${encodeURIComponent(repo.name)}/commits?per_page=1`, env);
        if (commits[0]?.commit?.author?.date) latestCommitAt = commits[0].commit.author.date;
      } catch (_) {
        // Repository timestamps are sufficient fallback; never fail the whole page.
      }
      const project = PRIVATE_PROJECTS[repo.name] || {};
      return {
        type: 'PrivateProjectEvent',
        repo: repo.name,
        created_at: latestCommitAt,
        detail: 'code updated',
        private: true,
        description: project.description || 'Private software project.',
        label: project.label || 'PRIVATE'
      };
    }));

    const activity = [...publicActivity, ...privateActivity]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      .slice(0, 20);

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
      repos: publicRepos.map(repoSnapshot),
      private_projects: privateRepos.map((repo) => {
        const project = PRIVATE_PROJECTS[repo.name] || {};
        return {
          name: repo.name,
          description: project.description || 'Private software project.',
          label: project.label || 'PRIVATE',
          pushed_at: repo.pushed_at,
          updated_at: repo.updated_at,
          language: repo.language
        };
      }),
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
