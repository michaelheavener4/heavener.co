export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === 'github.heavener.co' && url.pathname === '/') {
    url.pathname = '/github/';
    return context.env.ASSETS.fetch(url);
  }

  return context.next();
}
