const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

const typeLabel = (event) => ({
  PushEvent: 'PUSH',
  CreateEvent: 'CREATED',
  PullRequestEvent: 'PULL REQUEST',
  IssuesEvent: 'ISSUE',
  IssueCommentEvent: 'COMMENT',
  WatchEvent: 'STARRED',
  ForkEvent: 'FORKED'
}[event.type] || event.type.replace('Event', '').toUpperCase());

async function loadGithubPage() {
  const root = document.querySelector('[data-github-root]');
  if (!root) return;

  try {
    const response = await fetch('/api/github', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const data = await response.json();

    const profile = document.querySelector('[data-profile]');
    profile.innerHTML = `
      <img class="avatar" src="${escapeHtml(data.profile.avatar_url)}" alt="">
      <div>
        <div class="profile-name">${escapeHtml(data.profile.name || data.profile.handle)}</div>
        <div class="profile-handle">@${escapeHtml(data.profile.handle)}</div>
        <div class="profile-stats">
          <span>${data.profile.public_repos} repos</span>
          <span>${data.profile.followers} followers</span>
          <span>joined ${formatDate(data.profile.created_at)}</span>
        </div>
      </div>`;

    document.querySelector('[data-repos]').innerHTML = data.repos.map((repo) => `
      <a class="repo" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer">
        <div>
          <div class="repo-top"><span class="repo-meta">${escapeHtml(repo.language || 'CODE')}</span><span class="repo-link">↗</span></div>
          <h3>${escapeHtml(repo.name)}</h3>
          <p>${escapeHtml(repo.description || 'No description yet.')}</p>
          <div class="tags">${(repo.topics || []).slice(0, 5).map((topic) => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div>
        </div>
        <div class="repo-bottom"><span>★ ${repo.stars} · ⑂ ${repo.forks}</span><span>updated ${formatDate(repo.pushed_at)}</span></div>
      </a>`).join('');

    document.querySelector('[data-activity]').innerHTML = data.activity.map((event) => `
      <div class="activity-item">
        <div class="activity-type">${typeLabel(event)}</div>
        <div class="activity-body">${event.repo_url ? `<a href="${escapeHtml(event.repo_url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(event.repo)}</strong></a>` : `<strong>${escapeHtml(event.repo)}</strong>`}${event.detail ? ` — ${escapeHtml(event.detail)}` : ''}</div>
        <div class="activity-time">${formatDate(event.created_at)}</div>
      </div>`).join('') || '<div class="activity-item"><div class="status-line">No public activity returned.</div></div>';

    document.querySelector('[data-updated]').textContent = `LIVE · UPDATED ${formatDate(data.generated_at)}`;
  } catch (error) {
    root.innerHTML = `<p class="error">Could not load GitHub data. ${escapeHtml(error.message)}</p>`;
  }
}

loadGithubPage();
