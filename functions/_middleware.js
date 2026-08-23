export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);

  if (url.hostname === 'github.heavener.co' && url.pathname === '/') {
    const githubUrl = new URL('/github/', request.url);
    return env.ASSETS.fetch(new Request(githubUrl, request));
  }

  return next();
}
