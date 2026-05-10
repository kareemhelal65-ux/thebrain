const BaseAdapter = require('../BaseAdapter');

/**
 * MarketingAdapter — Abstract interface for Marketing platform providers.
 * Implementations: HubSpot Marketing, Mailchimp, or the Brain's internal marketing engine.
 */
class MarketingAdapter extends BaseAdapter {
  async campaign_create_marketing() { throw new Error('campaign_create_marketing not implemented'); }
  async marketing_analytics() { throw new Error('marketing_analytics not implemented'); }
  async seo_analysis() { throw new Error('seo_analysis not implemented'); }
  async social_media_post() { throw new Error('social_media_post not implemented'); }
  async social_media_analytics() { throw new Error('social_media_analytics not implemented'); }
  async content_calendar() { throw new Error('content_calendar not implemented'); }
  async email_campaign() { throw new Error('email_campaign not implemented'); }
  async landing_page_builder() { throw new Error('landing_page_builder not implemented'); }
  async brand_monitoring() { throw new Error('brand_monitoring not implemented'); }
  async marketing_budget_tracker() { throw new Error('marketing_budget_tracker not implemented'); }
  async competitor_analysis() { throw new Error('competitor_analysis not implemented'); }
  async content_generator() { throw new Error('content_generator not implemented'); }
}

module.exports = MarketingAdapter;
