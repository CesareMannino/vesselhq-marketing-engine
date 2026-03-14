const fallbackTopics = [
  {
    title: 'Fuel-Efficient Voyage Planning',
    angle: 'How data-led routing helps fleets cut costs and emissions'
  },
  {
    title: 'Digital Chartering Workflows',
    angle: 'Why faster quoting and cleaner handoffs improve win rates'
  },
  {
    title: 'Port Call Visibility',
    angle: 'How real-time operational updates build shipper confidence'
  }
];

function generateFallbackTopic() {
  const index = Math.floor(Math.random() * fallbackTopics.length);
  return fallbackTopics[index];
}

module.exports = {
  generateFallbackTopic
};
