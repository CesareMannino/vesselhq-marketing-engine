class MarketingPost {
  constructor({
    id,
    topicId,
    platform,
    content,
    imagePrompt,
    imageUrl,
    publishStatus,
    createdAt
  }) {
    this.id = id;
    this.topicId = topicId;
    this.platform = platform;
    this.content = content;
    this.imagePrompt = imagePrompt;
    this.imageUrl = imageUrl;
    this.publishStatus = publishStatus;
    this.createdAt = createdAt;
  }
}

module.exports = MarketingPost;
