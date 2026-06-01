const supabase = require('../models/supabaseClient');
const { emitNotification } = require('../api/notificationRoutes');

/**
 * Proactivity Scheduler — The Brain's Autonomous Pulse
 * 
 * Scans across all companies on a periodic basis to generate proactive
 * suggestions. Three scan types run at different intervals:
 * 
 * 1. OVERDUE SCAN (every 5 min): Detects action items past due date
 * 2. DEADLINE SCAN (every 15 min): Detects items due within 24h/48h/7d
 * 3. CROSS-DOC SCAN (every 5 min for first pass, then throttled): 
 *    Connects meetings to documents, decisions to action items, etc.
 * 
 * Suggestions are stored in proactive_suggestions and pushed via SSE.
 */

const SCAN_INTERVALS = {
  overdue: 5 * 60 * 1000,       // 5 minutes
  deadline: 15 * 60 * 1000,     // 15 minutes
  crossDoc: 5 * 60 * 1000       // 5 minutes
};

const MINIMUM_INTERVAL_BETWEEN_SCANS = {
  overdue: 3 * 60 * 1000,       // Don't re-scan same company within 3 min
  deadline: 10 * 60 * 1000,     // 10 min minimum
  crossDoc: 10 * 60 * 1000      // 10 min minimum
};

// ─── OVERDUE SCAN ───

/**
 * Scan all companies for overdue action items.
 * An item is overdue if: status='open' AND due_date < NOW()
 */
async function scanOverdueActionItems() {
  console.log('[ProactivityScheduler] Scanning for overdue action items...');
  let scannedCount = 0;
  let suggestionCount = 0;

  try {
    // Get all distinct tenant IDs from action_items that have open items with past due dates
    const { data: overdueItems, error } = await supabase
      .from('action_items')
      .select(`
        id,
        task,
        assignee,
        due_date,
        department,
        tenant_id,
        source_doc_id,
        brain_documents!left(id, title, document_type)
      `)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', new Date().toISOString())
      .order('due_date', { ascending: true });

    if (error) {
      console.error('[ProactivityScheduler] Overdue scan query failed:', error.message);
      return { scannedCount: 0, suggestionCount: 0 };
    }

    if (!overdueItems || overdueItems.length === 0) {
      console.log('[ProactivityScheduler] No overdue items found.');
      return { scannedCount: 0, suggestionCount: 0 };
    }

    // Group by tenant for efficient state checking
    const groupedByTenant = {};
    for (const item of overdueItems) {
      if (!groupedByTenant[item.tenant_id]) {
        groupedByTenant[item.tenant_id] = [];
      }
      groupedByTenant[item.tenant_id].push(item);
    }

    // Check scheduler_state for each tenant to avoid re-scanning too frequently
    const tenantIds = Object.keys(groupedByTenant);
    const { data: states } = await supabase
      .from('scheduler_state')
      .select('tenant_id, last_overdue_scan')
      .in('tenant_id', tenantIds);

    const lastScanMap = {};
    if (states) {
      for (const s of states) {
        lastScanMap[s.tenant_id] = new Date(s.last_overdue_scan || 0).getTime();
      }
    }

    const now = Date.now();

    for (const [tenantId, items] of Object.entries(groupedByTenant)) {
      // Skip if scanned too recently
      const lastScan = lastScanMap[tenantId] || 0;
      if (now - lastScan < MINIMUM_INTERVAL_BETWEEN_SCANS.overdue) {
        continue;
      }

      scannedCount++;

      // Generate suggestions for each overdue item
      for (const item of items) {
        const daysOverdue = Math.floor(
          (now - new Date(item.due_date).getTime()) / (1000 * 60 * 60 * 24)
        );

        const urgency = daysOverdue >= 7 ? 'high' : daysOverdue >= 3 ? 'high' : 'medium';
        const assigneeText = item.assignee ? ` (assigned to ${item.assignee})` : '';

        const { data: insertedOverdue, error: insertError } = await supabase
          .from('proactive_suggestions')
          .insert([{
            tenant_id: tenantId,
            category: 'overdue_task',
            title: `Overdue: ${item.task}`,
            description: `Action item "${item.task}"${assigneeText} is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue. Due date was ${new Date(item.due_date).toLocaleDateString()}.`,
            priority: urgency,
            source_entity_type: 'action_item',
            source_entity_id: item.id,
            metadata: {
              due_date: item.due_date,
              days_overdue: daysOverdue,
              department: item.department,
              source_doc_title: item.brain_documents?.title || null
            }
          }])
          .select();

        if (!insertError && insertedOverdue && insertedOverdue.length > 0) {
          suggestionCount++;
          // Emit real-time SSE event for each new suggestion
          emitNewSuggestion(tenantId, insertedOverdue[0]);
        }
      }

      // Update scheduler state
      await supabase
        .from('scheduler_state')
        .upsert({
          tenant_id: tenantId,
          last_overdue_scan: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });

      // Notify users in this company about overdue items
      await notifyCompany(tenantId, 'overdue_scan', {
        overdue_count: items.length,
        scan_time: new Date().toISOString()
      });
    }

    console.log(`[ProactivityScheduler] Overdue scan complete: scanned ${scannedCount} tenants, created ${suggestionCount} suggestions.`);
    return { scannedCount, suggestionCount };
  } catch (err) {
    console.error('[ProactivityScheduler] Overdue scan error:', err.message);
    return { scannedCount: 0, suggestionCount: 0 };
  }
}

// ─── DEADLINE SCAN ───

/**
 * Scan for upcoming deadlines within 24h, 48h, and 7d windows.
 */
async function scanUpcomingDeadlines() {
  console.log('[ProactivityScheduler] Scanning for upcoming deadlines...');
  let scannedCount = 0;
  let suggestionCount = 0;

  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all open action items with upcoming due dates
    const { data: upcomingItems, error } = await supabase
      .from('action_items')
      .select(`
        id,
        task,
        assignee,
        due_date,
        department,
        tenant_id,
        source_doc_id,
        brain_documents!left(id, title, document_type)
      `)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .gte('due_date', now.toISOString())
      .lte('due_date', in7d)
      .order('due_date', { ascending: true });

    if (error) {
      console.error('[ProactivityScheduler] Deadline scan query failed:', error.message);
      return { scannedCount: 0, suggestionCount: 0 };
    }

    if (!upcomingItems || upcomingItems.length === 0) {
      console.log('[ProactivityScheduler] No upcoming deadlines found.');
      return { scannedCount: 0, suggestionCount: 0 };
    }

    // Group by tenant
    const groupedByTenant = {};
    for (const item of upcomingItems) {
      if (!groupedByTenant[item.tenant_id]) {
        groupedByTenant[item.tenant_id] = [];
      }
      groupedByTenant[item.tenant_id].push(item);
    }

    // Check scheduler state
    const tenantIds = Object.keys(groupedByTenant);
    const { data: states } = await supabase
      .from('scheduler_state')
      .select('tenant_id, last_deadline_scan')
      .in('tenant_id', tenantIds);

    const lastScanMap = {};
    if (states) {
      for (const s of states) {
        lastScanMap[s.tenant_id] = new Date(s.last_deadline_scan || 0).getTime();
      }
    }

    const nowTs = Date.now();

    for (const [tenantId, items] of Object.entries(groupedByTenant)) {
      const lastScan = lastScanMap[tenantId] || 0;
      if (nowTs - lastScan < MINIMUM_INTERVAL_BETWEEN_SCANS.deadline) {
        continue;
      }

      scannedCount++;

      for (const item of items) {
        const dueMs = new Date(item.due_date).getTime();
        const hoursUntil = Math.round((dueMs - nowTs) / (1000 * 60 * 60));
        const daysUntil = Math.round((dueMs - nowTs) / (1000 * 60 * 60 * 24));

        let priority = 'low';
        let description = '';

        if (hoursUntil <= 24) {
          priority = 'high';
          description = `URGENT: "${item.task}" is due within 24 hours${item.assignee ? ` (assigned to ${item.assignee})` : ''}. Due: ${new Date(item.due_date).toLocaleDateString()}.`;
        } else if (hoursUntil <= 48) {
          priority = 'high';
          description = `Due within 48 hours: "${item.task}"${item.assignee ? ` (assigned to ${item.assignee})` : ''}. Due: ${new Date(item.due_date).toLocaleDateString()}.`;
        } else if (daysUntil <= 3) {
          priority = 'medium';
          description = `Due in ${daysUntil} days: "${item.task}"${item.assignee ? ` (assigned to ${item.assignee})` : ''}. Due: ${new Date(item.due_date).toLocaleDateString()}.`;
        } else {
          priority = 'low';
          description = `Upcoming deadline (${daysUntil} days): "${item.task}"${item.assignee ? ` (assigned to ${item.assignee})` : ''}. Due: ${new Date(item.due_date).toLocaleDateString()}.`;
        }

        const { data: insertedDeadline, error: insertError } = await supabase
          .from('proactive_suggestions')
          .insert([{
            tenant_id: tenantId,
            category: 'upcoming_deadline',
            title: hoursUntil <= 24 ? `Due soon: ${item.task}` : `Upcoming: ${item.task}`,
            description,
            priority,
            source_entity_type: 'action_item',
            source_entity_id: item.id,
            metadata: {
              due_date: item.due_date,
              hours_until_due: hoursUntil,
              days_until_due: daysUntil,
              department: item.department,
              assignee: item.assignee,
              source_doc_title: item.brain_documents?.title || null
            }
          }])
          .select();

        if (!insertError && insertedDeadline && insertedDeadline.length > 0) {
          suggestionCount++;
          // Emit real-time SSE event for each new suggestion
          emitNewSuggestion(tenantId, insertedDeadline[0]);
        }
      }

      await supabase
        .from('scheduler_state')
        .upsert({
          tenant_id: tenantId,
          last_deadline_scan: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });

      await notifyCompany(tenantId, 'deadline_scan', {
        upcoming_count: items.length,
        scan_time: new Date().toISOString()
      });
    }

    console.log(`[ProactivityScheduler] Deadline scan complete: scanned ${scannedCount} tenants, created ${suggestionCount} suggestions.`);
    return { scannedCount, suggestionCount };
  } catch (err) {
    console.error('[ProactivityScheduler] Deadline scan error:', err.message);
    return { scannedCount: 0, suggestionCount: 0 };
  }
}

// ─── CROSS-DOCUMENT SCAN ───

/**
 * Scan for cross-document intelligence connections.
 * E.g.: a meeting discussing a document, a decision linked to an action item,
 * a document referencing another document.
 */
async function scanCrossDocumentConnections() {
  console.log('[ProactivityScheduler] Scanning for cross-document connections...');
  let scannedCount = 0;
  let suggestionCount = 0;

  try {
    // Get all companies that have data
    const { data: companies, error: compError } = await supabase
      .from('companies')
      .select('id, name');

    if (compError || !companies) {
      console.error('[ProactivityScheduler] Failed to list companies:', compError?.message);
      return { scannedCount: 0, suggestionCount: 0 };
    }

    // Check scheduler state for each company
    const companyIds = companies.map(c => c.id);
    const { data: states } = await supabase
      .from('scheduler_state')
      .select('tenant_id, last_cross_doc_scan')
      .in('tenant_id', companyIds);

    const lastScanMap = {};
    if (states) {
      for (const s of states) {
        lastScanMap[s.tenant_id] = new Date(s.last_cross_doc_scan || 0).getTime();
      }
    }

    const nowTs = Date.now();

    for (const company of companies) {
      const tenantId = company.id;
      const lastScan = lastScanMap[tenantId] || 0;

      if (nowTs - lastScan < MINIMUM_INTERVAL_BETWEEN_SCANS.crossDoc) {
        continue;
      }

      scannedCount++;

      // Pattern 1: Recent meetings that reference documents (by title/name similarity)
      const { data: recentMeetings } = await supabase
        .from('meetings')
        .select('id, title, insights, meeting_date')
        .eq('company_id', tenantId)
        .gte('meeting_date', new Date(nowTs - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('meeting_date', { ascending: false })
        .limit(5);

      if (recentMeetings && recentMeetings.length > 0) {
        // Get recent documents for this company
        const { data: recentDocs } = await supabase
          .from('brain_documents')
          .select('id, title, document_type')
          .eq('company_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(10);

        if (recentDocs && recentDocs.length > 0) {
          // Check if any meeting title or insights mention a document title
          for (const meeting of recentMeetings) {
            const meetingText = `${meeting.title || ''} ${meeting.insights?.summary || ''} ${JSON.stringify(meeting.insights || {})}`.toLowerCase();

            for (const doc of recentDocs) {
              const docTitle = doc.title?.toLowerCase() || '';
              // Skip if doc title is too short or generic
              if (docTitle.length < 5) continue;

              // Check if meeting content mentions the document
              const docWords = docTitle.split(/\s+/).filter(w => w.length > 3);
              const matchCount = docWords.filter(w => meetingText.includes(w)).length;
              const matchRatio = docWords.length > 0 ? matchCount / docWords.length : 0;

              if (matchRatio >= 0.5 && matchCount >= 2) {
                // This meeting likely references this document
                const { data: insertedCross, error: insertError } = await supabase
                  .from('proactive_suggestions')
                  .insert([{
                    tenant_id: tenantId,
                    category: 'cross_doc_connection',
                    title: `Meeting references: "${doc.title}"`,
                    description: `The meeting "${meeting.title || 'Untitled'}" on ${new Date(meeting.meeting_date).toLocaleDateString()} appears to reference the document "${doc.title}". You may want to review both together.`,
                    priority: 'medium',
                    source_entity_type: 'meeting',
                    source_entity_id: meeting.id,
                    metadata: {
                      meeting_id: meeting.id,
                      meeting_title: meeting.title,
                      meeting_date: meeting.meeting_date,
                      document_id: doc.id,
                      document_title: doc.title,
                      document_type: doc.document_type,
                      match_ratio: matchRatio
                    }
                  }])
                  .select();

                if (!insertError && insertedCross && insertedCross.length > 0) {
                  suggestionCount++;
                  // Emit real-time SSE event for each new suggestion
                  emitNewSuggestion(tenantId, insertedCross[0]);
                }
              }
            }
          }
        }
      }

      // Pattern 2: Decisions made without linked action items
      const { data: recentDecisions } = await supabase
        .from('decisions')
        .select('id, text, date, source_doc_id')
        .eq('tenant_id', tenantId)
        .gte('date', new Date(nowTs - 14 * 24 * 60 * 60 * 1000).toISOString())
        .order('date', { ascending: false })
        .limit(10);

      if (recentDecisions && recentDecisions.length > 0) {
        const decisionIds = recentDecisions.map(d => d.id);
        
        // Check which decisions have associated action items
        const { data: linkedItems } = await supabase
          .from('action_items')
          .select('source_doc_id')
          .eq('tenant_id', tenantId)
          .in('source_doc_id', recentDecisions.filter(d => d.source_doc_id).map(d => d.source_doc_id));

        const linkedDocIds = new Set((linkedItems || []).map(i => i.source_doc_id));

        for (const decision of recentDecisions) {
          // If the decision's source doc has no action items, suggest creating some
          if (decision.source_doc_id && !linkedDocIds.has(decision.source_doc_id)) {
            const { data: insertedGap, error: insertError } = await supabase
              .from('proactive_suggestions')
              .insert([{
                tenant_id: tenantId,
                category: 'decision_gap',
                title: `No action items for decision: "${decision.text?.substring(0, 60)}..."`,
                description: `A decision was made on ${new Date(decision.date).toLocaleDateString()}: "${decision.text?.substring(0, 200)}". Consider creating action items to follow through on this decision.`,
                priority: 'medium',
                source_entity_type: 'decision',
                source_entity_id: decision.id,
                metadata: {
                  decision_id: decision.id,
                  decision_text: decision.text,
                  decision_date: decision.date,
                  source_doc_id: decision.source_doc_id
                }
              }])
              .select();

            if (!insertError && insertedGap && insertedGap.length > 0) {
              suggestionCount++;
              // Emit real-time SSE event for each new suggestion
              emitNewSuggestion(tenantId, insertedGap[0]);
            }
          }
        }
      }

      // Update scheduler state
      await supabase
        .from('scheduler_state')
        .upsert({
          tenant_id: tenantId,
          last_cross_doc_scan: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, { onConflict: 'tenant_id' });
    }

    console.log(`[ProactivityScheduler] Cross-doc scan complete: scanned ${scannedCount} tenants, created ${suggestionCount} suggestions.`);
    return { scannedCount, suggestionCount };
  } catch (err) {
    console.error('[ProactivityScheduler] Cross-doc scan error:', err.message);
    return { scannedCount: 0, suggestionCount: 0 };
  }
}

// ─── ON-DEMAND SCAN ───

/**
 * Run a full scan for a single company on-demand.
 * Used when a new document or meeting is ingested.
 * Only scans the specified company, not all companies.
 */
async function scanCompany(companyId) {
  console.log(`[ProactivityScheduler] Running on-demand scan for company ${companyId}...`);

  try {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const nowTs = Date.now();

    // ─── Newly Uploaded Documents Scan ───
    let newDocCount = 0;
    try {
      // Get last scan time from scheduler_state
      const { data: stateData } = await supabase
        .from('scheduler_state')
        .select('last_overdue_scan, last_cross_doc_scan')
        .eq('tenant_id', companyId)
        .single();

      // Use last scan time or default to 7 days ago
      const lastScanMs = Math.max(
        new Date(stateData?.last_overdue_scan || 0).getTime(),
        new Date(stateData?.last_cross_doc_scan || 0).getTime()
      );
      const cutoffTime = lastScanMs > 0
        ? new Date(lastScanMs).toISOString()
        : new Date(nowTs - 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: newDocs } = await supabase
        .from('brain_documents')
        .select('id, title, document_type, department, semantic_type, sub_type, created_at')
        .eq('company_id', companyId)
        .gte('created_at', cutoffTime)
        .order('created_at', { ascending: false });

      if (newDocs && newDocs.length > 0) {
        for (const doc of newDocs) {
          // Check if a suggestion for this doc already exists
          const { data: existing } = await supabase
            .from('proactive_suggestions')
            .select('id')
            .eq('tenant_id', companyId)
            .eq('source_entity_type', 'document')
            .eq('source_entity_id', doc.id)
            .limit(1);

          if (!existing || existing.length === 0) {
            const { data: inserted } = await supabase
              .from('proactive_suggestions')
              .insert([{
                tenant_id: companyId,
                category: 'new_document',
                title: `New document: ${doc.title}`,
                description: `Document "${doc.title}" (${doc.document_type || 'markdown'}) was uploaded and indexed.${doc.department ? ` Department: ${doc.department}.` : ''}${doc.semantic_type ? ` Type: ${doc.semantic_type}.` : ''}`,
                priority: 'low',
                source_entity_type: 'document',
                source_entity_id: doc.id,
                metadata: {
                  document_id: doc.id,
                  document_title: doc.title,
                  document_type: doc.document_type,
                  department: doc.department,
                  semantic_type: doc.semantic_type,
                  sub_type: doc.sub_type
                }
              }])
              .select();

            if (inserted && inserted.length > 0) {
              newDocCount++;
              emitNewSuggestion(companyId, inserted[0]);
            }
          }
        }
      }
    } catch (err) {
      console.error('[ProactivityScheduler] New document scan error:', err.message);
    }

    // ─── Overdue items for this company ───
    const { data: overdueItems } = await supabase
      .from('action_items')
      .select('id, task, assignee, due_date, department, source_doc_id')
      .eq('tenant_id', companyId)
      .eq('status', 'open')
      .not('due_date', 'is', null)
      .lt('due_date', now.toISOString())
      .order('due_date', { ascending: true });

    let overdueCount = 0;
    if (overdueItems && overdueItems.length > 0) {
      for (const item of overdueItems) {
        const daysOverdue = Math.floor((nowTs - new Date(item.due_date).getTime()) / (1000 * 60 * 60 * 24));
        const urgency = daysOverdue >= 3 ? 'high' : 'medium';
        const { data: insertedOd } = await supabase.from('proactive_suggestions').insert([{
          tenant_id: companyId,
          category: 'overdue_task',
          title: `Overdue: ${item.task}`,
          description: `Action item is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue${item.assignee ? ` (assigned to ${item.assignee})` : ''}.`,
          priority: urgency,
          source_entity_type: 'action_item',
          source_entity_id: item.id,
          metadata: { due_date: item.due_date, days_overdue: daysOverdue, department: item.department }
        }]).select();
        if (insertedOd && insertedOd.length > 0) {
          overdueCount++;
          emitNewSuggestion(companyId, insertedOd[0]);
        }
      }
    }

    // ─── Cross-doc connections for this company ───
    let crossDocCount = 0;
    const { data: recentMeetings } = await supabase
      .from('meetings')
      .select('id, title, insights, meeting_date')
      .eq('company_id', companyId)
      .gte('meeting_date', new Date(nowTs - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('meeting_date', { ascending: false })
      .limit(5);

    if (recentMeetings && recentMeetings.length > 0) {
      const { data: recentDocs } = await supabase
        .from('brain_documents')
        .select('id, title, document_type')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentDocs && recentDocs.length > 0) {
        for (const meeting of recentMeetings) {
          const meetingText = `${meeting.title || ''} ${meeting.insights?.summary || ''} ${JSON.stringify(meeting.insights || {})}`.toLowerCase();
          for (const doc of recentDocs) {
            const docTitle = doc.title?.toLowerCase() || '';
            if (docTitle.length < 5) continue;
            const docWords = docTitle.split(/\s+/).filter(w => w.length > 3);
            const matchCount = docWords.filter(w => meetingText.includes(w)).length;
            const matchRatio = docWords.length > 0 ? matchCount / docWords.length : 0;
            if (matchRatio >= 0.5 && matchCount >= 2) {
              const { data: insertedCd } = await supabase.from('proactive_suggestions').insert([{
                tenant_id: companyId,
                category: 'cross_doc_connection',
                title: `Meeting references: "${doc.title}"`,
                description: `Meeting "${meeting.title || 'Untitled'}" on ${new Date(meeting.meeting_date).toLocaleDateString()} references "${doc.title}".`,
                priority: 'medium',
                source_entity_type: 'meeting',
                source_entity_id: meeting.id,
                metadata: {
                  meeting_id: meeting.id,
                  meeting_title: meeting.title,
                  document_id: doc.id,
                  document_title: doc.title,
                  match_ratio: matchRatio
                }
              }]).select();
              if (insertedCd && insertedCd.length > 0) {
                crossDocCount++;
                emitNewSuggestion(companyId, insertedCd[0]);
              }
            }
          }
        }
      }
    }

    // Update scheduler state
    await supabase.from('scheduler_state').upsert({
      tenant_id: companyId,
      last_overdue_scan: now.toISOString(),
      last_cross_doc_scan: now.toISOString(),
      updated_at: now.toISOString()
    }, { onConflict: 'tenant_id' });

    console.log(`[ProactivityScheduler] On-demand scan complete for ${companyId}: ${overdueCount} overdue, ${crossDocCount} cross-doc, ${newDocCount} new documents.`);
    return { overdue: { suggestionCount: overdueCount }, crossDoc: { suggestionCount: crossDocCount }, newDocuments: { suggestionCount: newDocCount } };
  } catch (err) {
    console.error(`[ProactivityScheduler] On-demand scan failed for ${companyId}:`, err.message);
    return { overdue: { suggestionCount: 0, error: err.message }, crossDoc: { suggestionCount: 0 }, newDocuments: { suggestionCount: 0 } };
  }
}

// ─── NOTIFICATION HELPERS ───

/**
 * Emit a new_suggestion SSE event to all users in a company.
 * This enables real-time UI updates without polling.
 */
async function emitNewSuggestion(tenantId, suggestion) {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', tenantId);

    if (!error && users) {
      for (const user of users) {
        emitNotification(user.id, {
          type: 'new_suggestion',
          suggestion
        });
      }
    }
  } catch (err) {
    console.warn(`[ProactivityScheduler] Failed to emit suggestion to company ${tenantId}:`, err.message);
  }
}

/**
 * Notify all users in a company about a scan completion event via SSE.
 */
async function notifyCompany(companyId, scanType, data) {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', companyId);

    if (!error && users) {
      for (const user of users) {
        emitNotification(user.id, {
          type: 'proactivity_scan',
          scan_type: scanType,
          ...data
        });
      }
    }
  } catch (err) {
    console.warn(`[ProactivityScheduler] Failed to notify company ${companyId}:`, err.message);
  }
}

// ─── SCHEDULER LIFECYCLE ───

let intervals = [];

/**
 * Start the proactivity scheduler with periodic scans.
 * @param {number} [overdueInterval] - Override overdue scan interval in ms
 * @param {number} [deadlineInterval] - Override deadline scan interval in ms  
 * @param {number} [crossDocInterval] - Override cross-doc scan interval in ms
 */
function startScheduler(overdueInterval, deadlineInterval, crossDocInterval) {
  console.log('[ProactivityScheduler] Starting scheduler...');

  // Run initial scans immediately (staggered by 1s each)
  setTimeout(() => {
    scanOverdueActionItems();
  }, 1000);

  setTimeout(() => {
    scanUpcomingDeadlines();
  }, 2000);

  setTimeout(() => {
    scanCrossDocumentConnections();
  }, 3000);

  // Schedule periodic scans
  intervals.push(
    setInterval(scanOverdueActionItems, overdueInterval || SCAN_INTERVALS.overdue),
    setInterval(scanUpcomingDeadlines, deadlineInterval || SCAN_INTERVALS.deadline),
    setInterval(scanCrossDocumentConnections, crossDocInterval || SCAN_INTERVALS.crossDoc)
  );

  console.log('[ProactivityScheduler] Scheduler started. Intervals (ms):', {
    overdue: overdueInterval || SCAN_INTERVALS.overdue,
    deadline: deadlineInterval || SCAN_INTERVALS.deadline,
    crossDoc: crossDocInterval || SCAN_INTERVALS.crossDoc
  });
}

/**
 * Stop all scheduled scans.
 */
function stopScheduler() {
  console.log('[ProactivityScheduler] Stopping scheduler...');
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals = [];
  console.log('[ProactivityScheduler] Scheduler stopped.');
}

module.exports = {
  startScheduler,
  stopScheduler,
  scanOverdueActionItems,
  scanUpcomingDeadlines,
  scanCrossDocumentConnections,
  scanCompany
};
