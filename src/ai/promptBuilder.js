function buildLinkedInPrompt(topic) {
  return [
    'You are a B2B maritime marketing strategist.',
    'Write a polished LinkedIn post for maritime operators, brokers, or shipping decision-makers.',
    `Topic: ${topic.title}.`,
    `Angle: ${topic.angle}.`,
    'Keep the tone credible, modern, and commercially sharp.',
    'Include a concise hook, 2 short body paragraphs, and a final call to action.',
    'Do not use hashtags excessively. Use plain text only.'
  ].join(' ');
}

function buildImagePrompt(topic, content) {
  return [
    'Create a clean maritime marketing visual.',
    `Feature this concept: ${topic.title}.`,
    `Strategic angle: ${topic.angle}.`,
    `Reference copy theme: ${content.slice(0, 220)}.`,
    'Style: premium shipping industry campaign, ocean palette, modern vessel details, professional lighting, no text overlay.'
  ].join(' ');
}

module.exports = {
  buildLinkedInPrompt,
  buildImagePrompt
};
