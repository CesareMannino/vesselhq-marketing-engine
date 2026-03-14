function buildUtmUrl(baseUrl, campaign) {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', 'linkedin');
  url.searchParams.set('utm_medium', 'social');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

module.exports = {
  buildUtmUrl
};
