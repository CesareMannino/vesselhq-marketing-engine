CREATE DATABASE IF NOT EXISTS vesselhq_marketing;
USE vesselhq_marketing;

CREATE TABLE IF NOT EXISTS marketing_topics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  angle VARCHAR(255) NOT NULL,
  status ENUM('pending', 'used') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS marketing_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  topic_id INT NOT NULL,
  platform VARCHAR(50) NOT NULL DEFAULT 'linkedin',
  content TEXT NOT NULL,
  image_prompt TEXT NOT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  publish_status VARCHAR(50) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_marketing_posts_topic
    FOREIGN KEY (topic_id) REFERENCES marketing_topics(id)
);

CREATE TABLE IF NOT EXISTS marketing_prepared_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  import_key VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  image_url VARCHAR(500) DEFAULT NULL,
  platform VARCHAR(50) NOT NULL,
  scheduled_order INT NOT NULL,
  status ENUM('pending', 'published', 'failed') NOT NULL DEFAULT 'pending',
  campaign_tag VARCHAR(100) DEFAULT NULL,
  post_type VARCHAR(100) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_marketing_prepared_posts_import_key (import_key)
);

CREATE TABLE IF NOT EXISTS marketing_metrics (
  id INT AUTO_INCREMENT PRIMARY KEY,
  post_id INT NOT NULL,
  metric_type VARCHAR(100) NOT NULL,
  metric_value DECIMAL(12, 2) NOT NULL DEFAULT 0,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_marketing_metrics_post
    FOREIGN KEY (post_id) REFERENCES marketing_posts(id)
);

CREATE TABLE IF NOT EXISTS marketing_app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
