const nodemailer = require('nodemailer');
const dns = require('dns');
const net = require('net');
const logger = require('../utils/logger');

const DEFAULT_RECIPIENTS = [
  'khataleharshad26@gmail.com',
  'madanrajsagar83@gmail.com',
  'gaikwadshambhu24@gmail.com',
  'ameymohite2006@gmail.com',
];

const unavailableValuePattern = /^(unknown\b.*|not available|plate not readable|plate not detected|-|n\/a)$/i;

const safeText = (value, fallback = 'N/A') => {
  const str = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return str ? str : fallback;
};

const hasDisplayableValue = (value) => {
  const text = String(value ?? '').trim();
  return Boolean(text) && !unavailableValuePattern.test(text);
};

const formatTimestamp = (value) => {
  if (!value) {
    return 'N/A';
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return safeText(value);
    }

    return date.toLocaleString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return safeText(value);
  }
};

const formatCoordinate = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(6) : 'N/A';
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildMapLink = (location) => {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return '';
  }

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
};

const pickEvidenceWithUrls = (report) =>
  Array.isArray(report?.evidence) ? report.evidence.filter((item) => item?.url) : [];

const pickFirstVideoEvidenceUrl = (report) => {
  const evidence = pickEvidenceWithUrls(report);
  const video = evidence.find((item) => item?.type === 'video' && item?.url);
  if (video?.url) return String(video.url).trim();
  return evidence[0]?.url ? String(evidence[0].url).trim() : '';
};

const buildVehicleSummary = (vehicle = {}) =>
  [
    safeText(vehicle?.vehicleType, ''),
    safeText(vehicle?.vehicleBrand, ''),
    safeText(vehicle?.vehicleModel, ''),
    safeText(vehicle?.vehicleColor, ''),
  ]
    .filter(Boolean)
    .join(' | ');

const buildJourneyRows = (report) => {
  const rows = [];

  if (hasDisplayableValue(report?.journey?.mode)) {
    rows.push(['Journey Mode', safeText(report.journey.mode)]);
  }
  if (hasDisplayableValue(report?.journey?.destinationName || report?.destination?.name)) {
    rows.push(['Destination', safeText(report?.journey?.destinationName || report?.destination?.name)]);
  }
  if (Number.isFinite(Number(report?.journey?.etaMinutes))) {
    rows.push(['ETA', `${Number(report.journey.etaMinutes).toFixed(1)} min`]);
  }
  if (Number.isFinite(Number(report?.journey?.distanceKm))) {
    rows.push(['Distance', `${Number(report.journey.distanceKm).toFixed(2)} km`]);
  }
  if (hasDisplayableValue(report?.journey?.monitoringStatus)) {
    rows.push(['Monitoring', safeText(report.journey.monitoringStatus)]);
  }
  if (hasDisplayableValue(report?.zone?.name)) {
    rows.push(['Nearby Risk Zone', safeText(report.zone.name)]);
  }

  return rows;
};

const buildEmergencyEmailBodyFromReport = (report) => {
  const vehicle = report?.vehicle || report?.vehicleDetails || {};
  const vehicleSummary = buildVehicleSummary(vehicle);
  const mapLink = buildMapLink(report?.location);
  const videoUrl = safeText(pickFirstVideoEvidenceUrl(report), 'N/A');
  const timeline = Array.isArray(report?.timeline) ? report.timeline.filter(Boolean) : [];
  const evidence = pickEvidenceWithUrls(report);
  const journeyRows = buildJourneyRows(report);

  const lines = [
    'ABHAYA EMERGENCY INCIDENT REPORT',
    '',
    'REPORT TAG',
    `Incident ID: ${safeText(report?.incidentId)}`,
    `Reported At: ${formatTimestamp(report?.createdAt)}`,
    `Status: ${safeText(report?.status, 'ACTIVE')}`,
    `Trigger Type: ${safeText(report?.trigger?.type, 'SOS')}`,
    `Risk Score: ${safeText(report?.trigger?.riskScore, 'HIGH')}`,
    '',
    'USER INFORMATION',
    `User Name: ${safeText(report?.user?.name)}`,
    `User Phone: ${safeText(report?.user?.phone)}`,
    `User Email: ${safeText(report?.user?.email)}`,
    '',
    'LOCATION INFORMATION',
    `Address: ${safeText(report?.location?.address)}`,
    `Latitude: ${formatCoordinate(report?.location?.lat)}`,
    `Longitude: ${formatCoordinate(report?.location?.lng)}`,
    `Map Link: ${safeText(mapLink)}`,
  ];

  if (hasDisplayableValue(vehicle?.plateNumber) || hasDisplayableValue(vehicleSummary)) {
    lines.push(
      '',
      'VEHICLE INFORMATION',
      `Plate Number: ${safeText(vehicle?.plateNumber)}`,
      `Vehicle: ${safeText(vehicleSummary)}`,
      `Visible Mark: ${safeText(vehicle?.identificationMark)}`
    );
  }

  if (journeyRows.length) {
    lines.push('', 'JOURNEY SNAPSHOT');
    journeyRows.forEach(([label, value]) => {
      lines.push(`${label}: ${value}`);
    });
  }

  lines.push('', 'EVIDENCE', `Primary Video Link: ${videoUrl}`);
  evidence.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${safeText(item?.type, 'Evidence')} - ${safeText(item?.url)}`
    );
  });

  lines.push('', 'TIMELINE');
  if (timeline.length) {
    timeline.forEach((item, index) => {
      lines.push(`${index + 1}. ${safeText(item)}`);
    });
  } else {
    lines.push('No timeline available.');
  }

  return lines.join('\n');
};

const renderMetricRowsHtml = (rows = []) =>
  rows
    .filter(([, value]) => hasDisplayableValue(value))
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #f2ecff;color:#8c87a0;font-size:12px;font-weight:700;text-transform:uppercase;vertical-align:top;">${escapeHtml(
            label
          )}</td>
          <td style="padding:10px 0;border-top:1px solid #f2ecff;color:#1b1330;font-size:13px;font-weight:800;text-align:right;">${escapeHtml(
            value
          )}</td>
        </tr>
      `
    )
    .join('');

const renderSectionHtml = ({ title, subtitle, rows, extraHtml = '' }) => {
  if (!rows.length && !extraHtml) {
    return '';
  }

  return `
    <div style="background:#ffffff;border-radius:22px;padding:20px;margin-top:16px;box-shadow:0 8px 24px rgba(31,21,51,0.06);">
      <div style="font-size:18px;font-weight:900;color:#111111;">${escapeHtml(title)}</div>
      ${
        subtitle
          ? `<div style="margin-top:4px;color:#8c87a0;font-size:12px;line-height:18px;font-weight:600;">${escapeHtml(
              subtitle
            )}</div>`
          : ''
      }
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:14px;border-collapse:collapse;">
        ${renderMetricRowsHtml(rows)}
      </table>
      ${extraHtml}
    </div>
  `;
};

const buildEmergencyEmailHtmlFromReport = (report) => {
  const vehicle = report?.vehicle || report?.vehicleDetails || {};
  const vehicleSummary = buildVehicleSummary(vehicle);
  const mapLink = buildMapLink(report?.location);
  const evidence = pickEvidenceWithUrls(report);
  const journeyRows = buildJourneyRows(report);
  const timeline = Array.isArray(report?.timeline) ? report.timeline.filter(Boolean) : [];

  const reportTagRows = [
    ['Incident ID', safeText(report?.incidentId, '')],
    ['Reported At', formatTimestamp(report?.createdAt)],
    ['Status', safeText(report?.status, 'ACTIVE')],
    ['Trigger Type', safeText(report?.trigger?.type, 'SOS')],
    ['Risk Score', safeText(report?.trigger?.riskScore, 'HIGH')],
  ];

  const userRows = [
    ['User Name', safeText(report?.user?.name, '')],
    ['User Phone', safeText(report?.user?.phone, '')],
    ['User Email', safeText(report?.user?.email, '')],
  ];

  const vehicleRows = [
    ['Plate Number', safeText(vehicle?.plateNumber, '')],
    ['Vehicle', safeText(vehicleSummary, '')],
    ['Visible Mark', safeText(vehicle?.identificationMark, '')],
  ];

  const locationRows = [
    ['Address', safeText(report?.location?.address, '')],
    ['Latitude', formatCoordinate(report?.location?.lat)],
    ['Longitude', formatCoordinate(report?.location?.lng)],
  ];

  const evidenceHtml = evidence.length
    ? `
      <div style="margin-top:14px;">
        ${evidence
          .map(
            (item, index) => `
              <div style="border-top:1px solid #f2ecff;padding:12px 0;">
                <div style="color:#1b1330;font-size:13px;font-weight:800;">${escapeHtml(
                  `${index + 1}. ${safeText(item?.type, 'Evidence')}`
                )}</div>
                <div style="margin-top:6px;font-size:12px;color:#6c6880;line-height:18px;">${escapeHtml(
                  formatTimestamp(item?.timestamp)
                )}</div>
                <a href="${escapeHtml(item?.url)}" style="display:inline-block;margin-top:8px;color:#7b57d1;font-size:13px;font-weight:800;text-decoration:none;">
                  Open Evidence Link
                </a>
              </div>
            `
          )
          .join('')}
      </div>
    `
    : `<div style="margin-top:14px;color:#8c87a0;font-size:13px;font-weight:600;">No evidence attached yet.</div>`;

  const timelineHtml = timeline.length
    ? `
      <div style="margin-top:14px;">
        ${timeline
          .map(
            (item, index) => `
              <div style="border-top:1px solid #f2ecff;padding:12px 0;">
                <div style="color:#7b57d1;font-size:11px;font-weight:900;text-transform:uppercase;">Timeline ${index + 1}</div>
                <div style="margin-top:4px;color:#1b1330;font-size:13px;font-weight:800;line-height:19px;">${escapeHtml(
                  item
                )}</div>
              </div>
            `
          )
          .join('')}
      </div>
    `
    : `<div style="margin-top:14px;color:#8c87a0;font-size:13px;font-weight:600;">No timeline available yet.</div>`;

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:24px;background:#fbf9ff;font-family:Arial,sans-serif;color:#111111;">
        <div style="max-width:760px;margin:0 auto;">
          <div style="background:#1f1533;border-radius:24px;padding:24px;color:#ffffff;">
            <div style="display:inline-block;border-radius:999px;background:#f1e9ff;color:#7b57d1;font-size:11px;font-weight:900;padding:8px 12px;">
              ABHAYA REPORT TAG
            </div>
            <div style="margin-top:16px;font-size:30px;font-weight:900;line-height:1.15;">Emergency Incident Summary</div>
            <div style="margin-top:10px;color:#ddd3f2;font-size:14px;line-height:22px;font-weight:600;">
              Real-time incident report generated from the active Abhaya journey, including user identity, location, scanned vehicle details, evidence, and emergency-ready links.
            </div>
            <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;">
              ${
                mapLink
                  ? `<a href="${escapeHtml(
                      mapLink
                    )}" style="background:#f1e9ff;color:#7b57d1;text-decoration:none;padding:12px 16px;border-radius:16px;font-size:13px;font-weight:900;">Open Map</a>`
                  : ''
              }
              ${
                pickFirstVideoEvidenceUrl(report)
                  ? `<a href="${escapeHtml(
                      pickFirstVideoEvidenceUrl(report)
                    )}" style="background:#ea5455;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:16px;font-size:13px;font-weight:900;">Open Video Evidence</a>`
                  : ''
              }
            </div>
          </div>

          ${renderSectionHtml({
            title: 'Report Tag',
            subtitle: 'Core incident identifiers and current report status',
            rows: reportTagRows,
          })}

          ${renderSectionHtml({
            title: 'User Information',
            subtitle: 'Runtime user details pulled from the active logged-in session',
            rows: userRows,
          })}

          ${
            vehicleRows.some(([, value]) => hasDisplayableValue(value))
              ? renderSectionHtml({
                  title: 'Vehicle Information',
                  subtitle: 'Scanned vehicle details linked to the current journey when available',
                  rows: vehicleRows,
                })
              : ''
          }

          ${renderSectionHtml({
            title: 'Location Information',
            subtitle: 'Live incident coordinates captured during the journey SOS flow',
            rows: locationRows,
            extraHtml: mapLink
              ? `<a href="${escapeHtml(
                  mapLink
                )}" style="display:inline-block;margin-top:14px;background:#f2ebff;color:#7b57d1;text-decoration:none;padding:12px 16px;border-radius:16px;font-size:13px;font-weight:900;">View Incident Location</a>`
              : '',
          })}

          ${
            journeyRows.length
              ? renderSectionHtml({
                  title: 'Journey Snapshot',
                  subtitle: 'Runtime trip state captured when the alert escalated',
                  rows: journeyRows,
                })
              : ''
          }

          ${renderSectionHtml({
            title: 'Timeline',
            subtitle: 'Actions recorded while generating the incident report',
            rows: [],
            extraHtml: timelineHtml,
          })}

          ${renderSectionHtml({
            title: 'Evidence & Sharing',
            subtitle: 'Cloud evidence links attached to this incident report',
            rows: [],
            extraHtml: evidenceHtml,
          })}
        </div>
      </body>
    </html>
  `;
};

const parseBoolean = (value) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return undefined;
};

const resolveHostForSmtp = async (host) => {
  const cleanHost = String(host || '').trim();
  if (!cleanHost) return { connectHost: '', servername: false };

  if (net.isIP(cleanHost)) {
    return { connectHost: cleanHost, servername: false };
  }

  try {
    const res = await dns.promises.lookup(cleanHost, { family: 4 });
    return { connectHost: res?.address || cleanHost, servername: cleanHost };
  } catch (error) {
    const servers = (() => {
      try {
        return dns.getServers();
      } catch {
        return [];
      }
    })();

    const message =
      error?.message ||
      `Failed to resolve SMTP host "${cleanHost}". DNS servers: ${
        servers.length ? servers.join(', ') : 'unknown'
      }`;

    return { error: message, connectHost: '', servername: false };
  }
};

const createGmailTransporter = async () => {
  const user = String(process.env.EMAIL_USER || '').trim();
  const pass = String(process.env.EMAIL_PASS || '')
    .trim()
    .replace(/\s+/g, '');

  if (!user) return { ok: false, error: 'EMAIL_USER is missing in backend/.env.' };
  if (!pass) return { ok: false, error: 'EMAIL_PASS is missing in backend/.env.' };

  const smtpHost = String(process.env.EMAIL_HOST || 'smtp.gmail.com').trim();
  const smtpPort = Number(process.env.EMAIL_PORT || 465);
  const secureFromEnv = parseBoolean(process.env.EMAIL_SECURE);
  const smtpSecure = typeof secureFromEnv === 'boolean' ? secureFromEnv : smtpPort === 465;
  const connectionTimeout = Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 10000);
  const greetingTimeout = Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 10000);
  const socketTimeout = Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 15000);

  if (smtpHost === 'smtp.gmail.com' && !process.env.EMAIL_HOST) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
      connectionTimeout,
      greetingTimeout,
      socketTimeout,
    });

    return { ok: true, transporter, user };
  }

  const resolved = await resolveHostForSmtp(smtpHost);
  if (resolved?.error) return { ok: false, error: resolved.error };
  if (!resolved?.connectHost) return { ok: false, error: `SMTP host "${smtpHost}" is invalid.` };

  const transporter = nodemailer.createTransport({
    host: resolved.connectHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user, pass },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    ...(resolved.servername
      ? {
          tls: {
            servername: resolved.servername,
          },
        }
      : {}),
  });

  return { ok: true, transporter, user };
};

const sendEmergencyEmail = async (report, recipients = DEFAULT_RECIPIENTS) => {
  const transportResult = await createGmailTransporter();
  if (!transportResult.ok) {
    logger.warn('Emergency email transport unavailable', {
      error: transportResult.error,
    });
    return { success: false, error: transportResult.error };
  }

  const toList = Array.isArray(recipients) ? recipients : DEFAULT_RECIPIENTS;
  const cleanRecipients = toList.map((recipient) => String(recipient || '').trim()).filter(Boolean);
  if (!cleanRecipients.length) {
    return { success: false, error: 'No email recipients configured.' };
  }

  const subject = `Emergency Alert - Abhaya${report?.incidentId ? ` (${report.incidentId})` : ''}`;
  const text = buildEmergencyEmailBodyFromReport(report || {});
  const html = buildEmergencyEmailHtmlFromReport(report || {});

  logger.info('Sending emergency email', {
    incidentId: report?.incidentId,
    recipients: cleanRecipients,
  });

  try {
    const info = await transportResult.transporter.sendMail({
      from: transportResult.user,
      to: cleanRecipients.join(', '),
      subject,
      text,
      html,
    });

    logger.info('Emergency email sent', {
      messageId: info?.messageId,
      accepted: info?.accepted,
      rejected: info?.rejected,
      response: info?.response,
    });

    return { success: true, info };
  } catch (error) {
    logger.warn('Emergency email send failed', {
      message: error?.message || 'Email send failed.',
      code: error?.code,
      response: error?.response,
      responseCode: error?.responseCode,
      command: error?.command,
    });

    if (error?.code === 'EAUTH' || Number(error?.responseCode) === 535) {
      return {
        success: false,
        error:
          'Emergency email login failed. Update EMAIL_USER and EMAIL_PASS in backend/.env with a valid Gmail address and Gmail App Password.',
      };
    }

    return { success: false, error: error?.message || 'Failed to send emergency email.' };
  }
};

module.exports = {
  DEFAULT_RECIPIENTS,
  sendEmergencyEmail,
  buildEmergencyEmailBodyFromReport,
  buildEmergencyEmailHtmlFromReport,
};
