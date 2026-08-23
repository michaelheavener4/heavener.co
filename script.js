const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
};

const formatRelative = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, label] of units) {
    const count = Math.floor(seconds / size);
    if (count >= 1) return `${count} ${label}${count === 1 ? '' : 's'} ago`;
  }
  return 'just now';
};

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

const typeLabel = (event) => event.private ? 'PRIVATE PROJECT' : ({
  PushEvent: 'PUSH', CreateEvent: 'CREATED', DeleteEvent: 'DELETED', PullRequestEvent: 'PULL REQUEST',
  IssuesEvent: 'ISSUE', IssueCommentEvent: 'COMMENT', WatchEvent: 'STARRED', ForkEvent: 'FORKED', ReleaseEvent: 'RELEASE'
}[event.type] || event.type.replace('Event', '').toUpperCase());

async function loadGithubPage() {
  const root = document.querySelector('[data-github-root]');
  if (!root) return;

  try {
    const response = await fetch('/api/github', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const data = await response.json();

    document.querySelector('[data-profile]').innerHTML = `
      <a href="${escapeHtml(data.profile.html_url)}" target="_blank" rel="noopener noreferrer">
        <img class="avatar" src="${escapeHtml(data.profile.avatar_url)}" alt="${escapeHtml(data.profile.name || data.profile.handle)}">
      </a>
      <div>
        <div class="profile-name">${escapeHtml(data.profile.name || data.profile.handle)}</div>
        <div class="profile-handle">@${escapeHtml(data.profile.handle)}</div>
        ${data.profile.bio ? `<p class="profile-bio">${escapeHtml(data.profile.bio)}</p>` : ''}
        <div class="profile-stats">
          <span>${data.stats.repositories} projects</span>
          <span>${data.stats.public_repositories} public</span>
          <span>${data.stats.private_repositories} private</span>
          <span>${data.stats.stars} stars</span>
          <span>${data.profile.followers} followers</span>
        </div>
      </div>`;

    document.querySelector('[data-project-count]').textContent = `${data.stats.repositories} PROJECTS · ${data.stats.private_repositories} PRIVATE`;

    document.querySelector('[data-private-projects]').innerHTML = (data.private_projects || []).map((project) => `
      <article class="project-card">
        <div class="project-top"><span class="repo-meta">${escapeHtml(project.label)}</span><span class="live-mark"><span class="dot"></span>LIVE</span></div>
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description)}</p>
        <div class="project-bottom">
          <span>${escapeHtml(project.language || 'SOFTWARE')}</span>
          <span>updated ${escapeHtml(formatRelative(project.pushed_at || project.updated_at))}</span>
        </div>
      </article>`).join('') || '<div class="project-card"><div class="status-line">No private projects found.</div></div>';

    document.querySelector('[data-repos]').innerHTML = data.repos.map((repo) => `
      <a class="repo ${repo.archived ? 'is-archived' : ''}" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer">
        <div>
          <div class="repo-top"><span class="repo-meta">${escapeHtml(repo.language || 'CODE')}${repo.archived ? ' · ARCHIVED' : ''}</span><span class="repo-link">↗</span></div>
          <h3>${escapeHtml(repo.name)}</h3>
          <p>${escapeHtml(repo.description || 'No description yet.')}</p>
          <div class="tags">${(repo.topics || []).slice(0, 5).map((topic) => `<span class="tag">${escapeHtml(topic)}</span>`).join('')}</div>
        </div>
        <div class="repo-bottom"><span>★ ${repo.stars} · ⑂ ${repo.forks}</span><span>${formatRelative(repo.pushed_at)}</span></div>
      </a>`).join('') || '<div class="repo"><div class="status-line">No public repositories found.</div></div>';

    document.querySelector('[data-activity]').innerHTML = data.activity.map((event) => `
      <div class="activity-item ${event.private ? 'is-private' : ''}">
        <div class="activity-type">${typeLabel(event)}</div>
        <div class="activity-body">${event.private ? `<strong>${escapeHtml(event.repo)}</strong>` : `<a href="${escapeHtml(event.repo_url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(event.repo)}</strong></a>`}${event.detail ? ` <span class="activity-detail">— ${escapeHtml(event.detail)}</span>` : ''}</div>
        <div class="activity-time" title="${escapeHtml(formatDate(event.created_at))}">${escapeHtml(formatRelative(event.created_at))}</div>
      </div>`).join('') || '<div class="activity-item"><div class="status-line">No recent activity returned.</div></div>';

    document.querySelector('[data-updated]').textContent = `LIVE · ${formatRelative(data.generated_at)}`;
  } catch (error) {
    root.innerHTML = `<p class="error">Could not load GitHub data. ${escapeHtml(error.message)}</p>`;
  }
}

loadGithubPage();
setInterval(loadGithubPage, 120000);
