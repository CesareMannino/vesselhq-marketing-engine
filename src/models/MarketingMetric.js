class MarketingMetric {
  constructor({ id, postId, metricType, metricValue, capturedAt }) {
    this.id = id;
    this.postId = postId;
    this.metricType = metricType;
    this.metricValue = metricValue;
    this.capturedAt = capturedAt || new Date().toISOString();
  }
}

module.exports = MarketingMetric;
