class PreparedMarketingPost {
  constructor({
    id,
    importKey,
    text,
    imageUrl,
    platform,
    scheduledOrder,
    status,
    campaignTag,
    postType,
    createdAt,
    publishedAt
  }) {
    this.id = id;
    this.importKey = importKey;
    this.text = text;
    this.content = text;
    this.imageUrl = imageUrl;
    this.platform = platform;
    this.scheduledOrder = scheduledOrder;
    this.status = status;
    this.campaignTag = campaignTag;
    this.postType = postType;
    this.createdAt = createdAt;
    this.publishedAt = publishedAt;
  }
}

module.exports = PreparedMarketingPost;
