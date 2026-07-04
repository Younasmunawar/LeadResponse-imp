function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`${name} is missing.`);
  }

  return value;
}

function parseRecipientEmails(value) {
  const emails = String(value || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  if (emails.length === 0) {
    throw new Error("EMAIL_TO does not contain any valid recipient.");
  }

  return emails;
}

function buildEmailHtml(lead) {
  const rows = [
    ["Quality", lead.leadQuality],
    ["Name", lead.name],
    ["Phone", lead.phone],
    ["Email", lead.email],
    ["WhatsApp", lead.whatsappNumber],
    ["Intent", lead.intent],
    ["Purpose", lead.purpose],
    ["Property", lead.propertyType],
    ["Area", lead.preferredArea],
    ["Budget", lead.budget],
    ["Timeline", lead.timeline],
    ["Payment", lead.paymentMethod],
    ["Follow-up time", lead.bestFollowUpTime],
    ["Sentiment", lead.callerSentiment],
    ["Status", lead.status]
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td
            style="
              padding:9px;
              border:1px solid #e5e7eb;
              font-weight:bold;
              width:180px;
              background:#f9fafb;
            "
          >
            ${escapeHtml(label)}
          </td>

          <td
            style="
              padding:9px;
              border:1px solid #e5e7eb;
            "
          >
            ${escapeHtml(value || "unknown")}
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>New Kenny Voice Lead</title>
      </head>

      <body style="margin:0;padding:24px;background:#f3f4f6">
        <div
          style="
            font-family:Arial,sans-serif;
            max-width:760px;
            margin:auto;
            color:#1f2937;
            background:#ffffff;
            padding:24px;
            border-radius:12px;
          "
        >
          <h1 style="margin:0 0 4px 0">
            New Kenny Voice Lead
          </h1>

          <p style="margin:0 0 24px 0;color:#6b7280">
            Gemini lead analysis is complete.
          </p>

          <table
            style="
              border-collapse:collapse;
              width:100%;
              margin-bottom:24px;
            "
          >
            ${tableRows}
          </table>

          <h2 style="margin-bottom:8px">Summary</h2>

          <p style="line-height:1.6">
            ${escapeHtml(lead.summary || "No summary generated.")}
          </p>

          <h2 style="margin-bottom:8px">Next step</h2>

          <p style="line-height:1.6">
            ${escapeHtml(lead.nextStep || "Review the lead manually.")}
          </p>

          <h2 style="margin-bottom:8px">Transcript</h2>

          <pre
            style="
              white-space:pre-wrap;
              word-break:break-word;
              background:#f3f4f6;
              padding:14px;
              border-radius:8px;
              line-height:1.5;
              font-family:Arial,sans-serif;
            "
          >${escapeHtml(
            lead.transcript || "No transcript captured."
          )}</pre>
        </div>
      </body>
    </html>
  `;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function createTimeoutController(timeoutMilliseconds) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMilliseconds);

  return {
    controller,
    clear() {
      clearTimeout(timeoutId);
    }
  };
}

async function parseResponseBody(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return {
      message: rawBody
    };
  }
}

function shouldRetry(error) {
  if (!error?.status) {
    return true;
  }

  return error.status === 429 || error.status >= 500;
}

export async function sendLeadEmail(lead) {
  console.log("EMAIL_PROVIDER: brevo-http-api");

  const apiKey = requiredEnv("BREVO_API_KEY");
  const fromEmail = requiredEnv("EMAIL_FROM");
  const recipientEmails = parseRecipientEmails(
    requiredEnv("EMAIL_TO")
  );

  const fromName = String(
    process.env.EMAIL_FROM_NAME || "Kenny Voice Agent"
  ).trim();

  console.log(
    "Sending Brevo email to:",
    recipientEmails.join(", ")
  );

  console.log("Brevo sender:", fromEmail);

  const leadName = String(lead?.name || "Unknown");
  const leadQuality = String(
    lead?.leadQuality || "unknown"
  ).toUpperCase();

  const payload = {
    sender: {
      name: fromName,
      email: fromEmail
    },

    to: recipientEmails.map((email) => ({
      email,
      name: "Falcon Heights Team"
    })),

    subject: `Kenny lead: ${leadQuality} — ${leadName}`,

    htmlContent: buildEmailHtml(lead),

    tags: ["kenny-lead"]
  };

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const timeout = createTimeoutController(25000);

    try {
      console.log(`Brevo email attempt ${attempt} started.`);

      const response = await fetch(
        "https://api.brevo.com/v3/smtp/email",
        {
          method: "POST",

          headers: {
            accept: "application/json",
            "api-key": apiKey,
            "content-type": "application/json"
          },

          body: JSON.stringify(payload),

          signal: timeout.controller.signal
        }
      );

      const responseBody = await parseResponseBody(response);

      if (!response.ok) {
        const errorMessage =
          responseBody?.message ||
          responseBody?.error ||
          `Brevo returned HTTP ${response.status}`;

        const apiError = new Error(errorMessage);
        apiError.status = response.status;
        apiError.responseBody = responseBody;

        throw apiError;
      }

      console.log(
        "Lead email sent through Brevo:",
        responseBody.messageId || "accepted"
      );

      return true;
    } catch (error) {
      lastError = error;

      console.error("BREVO_EMAIL_ERROR:", {
        attempt,
        name: error?.name,
        message: error?.message,
        status: error?.status,
        cause: error?.cause,
        responseBody: error?.responseBody
      });

      if (!shouldRetry(error) || attempt === 3) {
        break;
      }

      await wait(attempt * 1500);
    } finally {
      timeout.clear();
    }
  }

  throw new Error(
    `Brevo email failed: ${
      lastError?.message || "Unknown Brevo email error"
    }`
  );
}
