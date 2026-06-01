/**
 * Tests for Slack Notification Service
 * Covers: notifyMeetingSummary, notifyText
 */

jest.mock('axios', () => ({
  post: jest.fn()
}));

const axios = require('axios');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SLACK_WEBHOOK_URL;
  jest.resetModules();
});

describe('notifyMeetingSummary', () => {
  test('skips when webhook URL not configured', async () => {
    const { notifyMeetingSummary } = require('../slackNotificationService');
    const result = await notifyMeetingSummary({ title: 'Test' });
    expect(result).toEqual({ sent: false, reason: 'No webhook URL configured' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('sends blocks when webhook URL is configured', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const { notifyMeetingSummary } = require('../slackNotificationService');
    axios.post.mockResolvedValueOnce({ status: 200 });
    const meeting = {
      title: 'Sprint Review',
      meeting_date: '2026-05-25T10:00:00Z',
      source_type: 'zoom',
      insights: {
        summary: 'Reviewed sprint goals',
        decisions: [{ decision: 'Ship on Friday' }],
        action_items: [{ task: 'Update docs', assignee: 'Alice', deadline: '2026-05-30' }]
      }
    };
    const result = await notifyMeetingSummary(meeting);
    expect(result).toEqual({ sent: true });
    expect(axios.post).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        text: expect.stringContaining('Meeting Summary'),
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'header' })
        ])
      })
    );
  });

  test('handles API error gracefully', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    const { notifyMeetingSummary } = require('../slackNotificationService');
    axios.post.mockRejectedValueOnce(new Error('Network error'));
    const result = await notifyMeetingSummary({ title: 'Test', insights: {} });
    expect(result.sent).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe('notifyText', () => {
  test('skips when webhook URL not configured', async () => {
    const { notifyText } = require('../slackNotificationService');
    const result = await notifyText('test');
    expect(result).toEqual({ sent: false, reason: 'No webhook URL' });
  });

  test('sends text when configured', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    jest.resetModules();
    const { notifyText } = require('../slackNotificationService');
    axios.post.mockResolvedValueOnce({ status: 200 });
    const result = await notifyText('Hello Slack');
    expect(result).toEqual({ sent: true });
    expect(axios.post).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      { text: 'Hello Slack' }
    );
  });
});
