const { google } = require('googleapis');
const { processWebhookTranscript } = require('./meetingService');

/**
 * Google Meet Ingestion Service
 * Fetches recent Google Meet transcripts from Google Drive and processes them.
 */

async function ingestGoogleMeetTranscripts(accessToken, tenantId) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  
  const drive = google.drive({ version: 'v3', auth });

  // Find the last 10 Meet transcripts in Google Drive. 
  // Meet transcripts are usually stored as Google Docs or text files with "Transcript" in the name
  // or created by the Meet app. We search for text or document files.
  const { data: fileList } = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.document' and name contains 'Transcript'",
    orderBy: 'createdTime desc',
    pageSize: 10,
    fields: 'files(id, name, createdTime, webViewLink)',
  });

  const files = fileList.files || [];
  let processedCount = 0;
  const results = [];

  for (const file of files) {
    try {
      const docs = google.docs({ version: 'v1', auth });
      const { data: doc } = await docs.documents.get({ documentId: file.id });
      
      let text = '';
      if (doc.body?.content) {
        for (const element of doc.body.content) {
          if (element.paragraph?.elements) {
            for (const el of element.paragraph.elements) {
              if (el.textRun?.content) {
                text += el.textRun.content;
              }
            }
          }
        }
      }

      if (!text.trim()) continue;

      // Simulate a webhook payload for processWebhookTranscript
      const simulatedPayload = {
        title: file.name.replace(' - Transcript', '').trim(),
        meeting_date: file.createdTime,
        participants: [], // Parsing participants from raw text is complex without the actual Meet API, but Llama handles it.
        transcript: text
      };

      // We reuse the webhook pipeline which normalizes, extracts insights, and indexes
      const result = await processWebhookTranscript('google-meet', simulatedPayload, tenantId);
      results.push(result);
      processedCount++;
      console.log(`[Google Meet] Processed transcript: ${file.name}`);
    } catch (err) {
      console.error(`[Google Meet] Failed to process transcript ${file.name}:`, err.message);
    }
  }

  return { processedCount, results };
}

module.exports = { ingestGoogleMeetTranscripts };
