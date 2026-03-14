class MarketingTopic {
  constructor({ id, title, angle, status, createdAt }) {
    this.id = id;
    this.title = title;
    this.angle = angle;
    this.status = status;
    this.createdAt = createdAt || new Date().toISOString();
  }
}

module.exports = MarketingTopic;
