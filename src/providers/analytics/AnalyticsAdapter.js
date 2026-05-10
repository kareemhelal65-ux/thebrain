const BaseAdapter = require('../BaseAdapter');

/**
 * AnalyticsAdapter — Abstract interface for Analytics/BI providers.
 * Implementations: Metabase, Looker, PowerBI, or the Brain's internal analytics engine.
 */
class AnalyticsAdapter extends BaseAdapter {
  async kpi_dashboard() { throw new Error('kpi_dashboard not implemented'); }
  async custom_report() { throw new Error('custom_report not implemented'); }
  async cohort_analysis() { throw new Error('cohort_analysis not implemented'); }
  async trend_analysis() { throw new Error('trend_analysis not implemented'); }
  async anomaly_detection() { throw new Error('anomaly_detection not implemented'); }
  async funnel_analysis() { throw new Error('funnel_analysis not implemented'); }
  async predictive_model() { throw new Error('predictive_model not implemented'); }
  async ab_test_analysis() { throw new Error('ab_test_analysis not implemented'); }
  async data_export() { throw new Error('data_export not implemented'); }
  async benchmark_comparison() { throw new Error('benchmark_comparison not implemented'); }
  async correlation_analysis() { throw new Error('correlation_analysis not implemented'); }
  async executive_summary() { throw new Error('executive_summary not implemented'); }
}

module.exports = AnalyticsAdapter;
